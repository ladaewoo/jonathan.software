const url               = 'mongodb://localhost:27017';
const dns               = require('native-dns');
const { MongoClient }   = require('mongodb');
const mongoClient       = new MongoClient(url);
const express           = require('express');
const dnsServer         = dns.createServer();
const morgan            = require('morgan');
const async             = require('async');
const https             = require('https');
const http              = require('http');
const fs                = require('fs');
const app               = express();
const path              = require('path');

let Records = null;
let entries = [];

require('dotenv').config();

app.use(morgan('combined'));

let types = {
    1: 'A',
    5: 'CNAME',
    16: 'TXT',
    28: 'AAAA',
    15: 'MX',
    33: 'SRV'
}

let subdomain = (domain, fn) => {
    if (!domain || typeof domain !== "string") {
        throw new Error("The first parameter must be a string representing the subdomain");
    }

    if (!fn || typeof fn !== "function" || fn.length < 3) {
        throw new Error("The second parameter must be a function that handles fn(req, res, next) params.");
    }

    return (req, res, next) => {    
        let host = req.headers.host;

        if (host === domain) {
            return fn(req, res, next);
        }

        req._subdomainLevel = req._subdomainLevel || 0;

        let subdomainSplit = domain.split('.');
        let len = subdomainSplit.length;
        let match = true;

        for (let i = 0; i < len; i++) {
            let expected = subdomainSplit[len - (i+1)];
            let actual = req.subdomains[i+req._subdomainLevel];

            if(expected === '*') { continue; }

            if(actual !== expected) {
                match = false;
                break;
            }
        }

        if  (match) {
            req._subdomainLevel++;
            return fn(req, res, next);
        } 

        next();
    }
}

// jonathan.software certificates
const key = fs.readFileSync('sslcert/server.key', 'utf8');
const cert = fs.readFileSync('sslcert/server.crt', 'utf8');

const credentials = { key, cert }

const authority = {
    address: '8.8.8.8',
    port: 53,
    type: 'udp'
};

const proxy = (question, response, cb) => {
    let request = dns.Request({
        question: question, 
        server: authority,
        timeout: 1000
    });

    request.on('message', (err, msg) => {
        msg.answer.forEach(a => response.answer.push(a));
    });

    request.on('end', cb);
    request.send();
}

const handleRequest = (request, response) => {
    let t = request.question[0].type;
    let type = types[t];

    console.log('request from', request.address.address, 'for', request.question[0].name, ' type:', type || t);

    let f = [];

    request.question.forEach(question => {
        let entry = entries.filter(entry => entry.domain == question.name);

        if (entry.length) {
            entry[0].records.forEach(record => {
                response.answer.push(dns[record.type](Object.assign(record, {
                    name: question.name
                })));
            });
        } else {
            f.push(cb => proxy(question, response, cb));
        }
    });

    async.parallel(f, () => {
        response.send();
    });
}

let handlers = {
    request: handleRequest,
    listening: () => console.log('server listening on ', dnsServer.address()),
    close: () => console.log('server closed:', dnsServer.address()),
    error: error => console.error(error.stack),
    socketError: error => console.error(error)
}

const addSubdomain = (domain) => {
    let subdomainSplit = domain.split('.');

    if (subdomainSplit.length > 2) {
        return { message : 'El subdominio debe ser un dominio de segundo nivel' };
    }

    let exists = entries.find(entry => entry.domain == domain.concat('.eaglesolutions.com.mx'));

    if (exists) {
        return { message : 'Ya existe el subdominio' }
    } else {
        let record = {
            domain: domain.concat('.eaglesolutions.com.mx'),
            records: [
                {
                    type: "A",
                    address: "52.188.80.246",
                    ttl: 1800
                }
            ]
        };

        entries.push(record);
        Records.insertOne(record);

        return { message : 'Subdominio agregado con éxito' }
    }
}

app.enable('trust proxy');

app.use((request, response, next) => {
    if (process.env.NODE_ENV == 'production' && request.secure) {
        return response.redirect("http://" + request.headers.host + request.url);
    }

    next();
}) 

let subdominios = express.Router();

subdominios.use('/assets', express.static(path.join(__dirname, 'landing/assets')));

subdominios.get('/', (req, res) => {
    let subdomain = req.headers.host.split('.');

    if (subdomain.length > 3) {
        res.send(`Bienvenido a pruebas de subdominios: ${subdomain.shift()}`);
    } else {
        res.sendFile(path.join(__dirname, '/landing/index.html'));  
    }
});

let fintech = express.Router();

fintech.all('/', (req, res) => {
    res.send({
        host : req.headers.host
    });
});

let main = express.Router();

main.all('/', (req, res) => {
    res.send({
        software : 'dns-proxy/server',
        version : '1.0.0',
        host : req.headers.host,
        time : new Date().toISOString()
    });
});

['lookup', 'resolve', 'reverse'].forEach(method => {
    main.get('/'.concat(method, '/:domain'), (req, res) => {
        dns[method](req.params.domain, (err, value) => {
            res.send({
                err,
                value
            });
        });
    });
});

main.get('/listar-dominios', (req, res) => {
    let html = '<h1>Lista de dominios</h1><br/>';
    html += entries.map(entry => `<a target="_blank" href="http://${entry.domain}">${entry.domain}</a>`).join('<br>');
    res.send(html);
})

main.get('/agregar-subdominio/:subdominio', (req, res) => {
    let result = addSubdomain(req.params.subdominio);
    res.send(result);
});

app.use(subdomain('jonathan.software', main));
app.use(subdomain('*.eaglesolutions', subdominios));
app.use(subdomain('finanzas.tech', fintech));

const initialize = async () => {
    const httpsServer = https.createServer(credentials, app);
    const httpServer = http.createServer(app);
    await mongoClient.connect();

    console.log('Connected to MongoDB');

    const db = mongoClient.db('dnsserver');
    Records = db.collection('records');
    entries = await Records.find({}).toArray();

    console.log('Loaded', entries.length, 'records');
    
    entries.forEach(entry => {
        console.log(entry.domain);

        entry.records.forEach(record => {
            console.log(JSON.stringify(record, null, 2));
        });
    });

    
    for (let handler in handlers) {
        dnsServer.on(handler, handlers[handler]);
    }
    
    dnsServer.serve(53);
    httpServer.listen(80);
    httpsServer.listen(443);
}

initialize();

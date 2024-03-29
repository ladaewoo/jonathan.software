// imap server

var IMAPServer = require('imapseagull'),
    AppStorage = require('imapseagull-storage-mongo'),
    fs = require('fs'),
    path = require('path');

var NAME = 'eaglesolutions.com.mx';

var storage = new AppStorage({
    name: NAME,
    debug: true,

    // directory to keep attachments from emails
    attachments_path: path.join(__dirname, './'),

    // connection string for mongo
    connection: 'mongodb://localhost:27017/dnsserver',

    // collections names
    messages: 'emails',
    users: 'users'
});

// function 'init' specified into AppStorage to provide availability to redefine it
storage.init(function(err) {
    if (err) throw new Error(err);

    var imapServer = IMAPServer({

        // Instead of imap-handler (https://github.com/andris9/imap-handler) you can choose
        // wo-imap-handler (https://github.com/whiteout-io/imap-handler) or anything you want with same API
        imapHandler: require('imap-handler'),

        debug: true,
        plugins: [
            // List of plugins. It can be string for modules from lib//plugins/*.js or functions, that will be
            // initialized as plugin_fn(<IMAPServer object>)
            'ID', 'STARTTLS', 'AUTH-PLAIN', 'SPECIAL-USE', 'NAMESPACE', 'IDLE', /*'LOGINDISABLED',*/
            'SASL-IR', 'ENABLE', 'LITERALPLUS', 'UNSELECT', 'CONDSTORE'
        ],
        id: {
            name: NAME,
            version: '1'
        },
        credentials: {
            // just for example
            //key: fs.readFileSync(path.join(__dirname, './node_modules/imapseagull/tests/server.crt')),
            //cert: fs.readFileSync(path.join(__dirname, './node_modules/imapseagull/tests/server.key'))
        },
        secureConnection: false,
        storage: storage,
        folders: {
            'INBOX': { // Inbox folder may be only here
                'special-use': '\\Inbox',
                type: 'personal'
            },
            '': {
                folders: {
                    'Drafts': {
                        'special-use': '\\Drafts', // 'special-use' feature is in core of our IMAP implementation
                        type: 'personal'
                    },
                    'Sent': {
                        'special-use': '\\Sent',
                        type: 'personal'
                    },
                    'Junk': {
                        'special-use': '\\Junk',
                        type: 'personal'
                    },
                    'Trash': {
                        'special-use': '\\Trash',
                        type: 'personal'
                    }
                }
            }
        }
    });

    imapServer.on('close', function() {
        console.log('IMAP server %s closed', NAME);
    });

    imapServer.listen(143, function() {
        console.log('IMAP server %s started', NAME);
    });

});
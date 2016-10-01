var io = require('socket.io').listen(1337);
var dl = require('delivery');
var fs = require('fs');
var firebase = require('firebase');
var crypto = require('crypto');

// Authenticate with firebase
var config = {
    apiKey: 'AIzaSyD--ACvhpg6AtGFXhdKwMgn8Lv8Q2oMTT4',
    authDomain: 'd-lock.firebaseapp.com',
    databaseURL: 'https://d-lock.firebaseio.com'
};
firebase.initializeApp(config);

var connections = {};

io.on('connection', function (socket) {
    var self = this;
    var user;

    console.log("User has connected");

    // Handle new connections
    socket.on('user.info', function (user) {
        // Store details for this connection
        self.user = user;

        console.log(user.email);
        console.log(user.mac);
        /* // DEBUG
        // Update connections dictionary
        if (user in connections) {
            connections[user].push(socket);
        }
        else {
            connections[user] = [socket];
        }
        */
    });

    // TODO handle disconnect - remove MAC from connections

    // Listen for incoming for files
    var delivery = dl.listen(socket);
    delivery.on('receive.success', function (file) {
        var params = file.params;
        fs.writeFile(file.name, file.buffer, function (err) {
            if (err) {
                console.log('Could not write initial data file');
            }
            else {
                console.log('File saved');
            }
        });

        // Load the data and act accordingly
        firebase.database().ref('users/' + user.email).once('value').then(function (snapshot) {
            var refmacs = snapshot.val().mac;
            if (checkMac(user.email, refmacs)) {
                distribute(user, socket, file);
            }
        });
    });


});


// 'socket' is the connection that send the file to the server
function distribute(user, socket, file) {

    // TODO split file with David's script and deposit chunks in a dir - subdir
    var chunks = fs.readdirSync('subdir');
    var sockets = connections[user];

    // Check if MAC number matches chunks
    if (chunks.length != sockets.length) {
        socket.emit('error.mac.num', {errorMessage: "Number of chunks did not match number of MAC addresses"})
    }

    // Send chunks
    for (i = 0; i < chunks.length; i++) {
        var delivery = dl.listen(sockets[i]);
        delivery.on('delivery.connect', function (delivery) {

            // Try to send
            delivery.send({
                name: chunk[i],
                path: chunk[i]
            });

            // If success, store routing info in database
            delivery.on('send.success', function (uid) {
                // Hash the file name for storage
                var hash = crypto.createHash('md5').update(file.name).digest('hex');
            });
        })
    }

}

function checkMAC(email, referenceMACs) {
    var active = connections[email];

    // Check if active and reference are the same
    same = true;
    for (i = 0; i < referenceMACs.length; i++) {
        if (active.indexOf(referenceMACs[i]) == -1) {
            same = false
        }
    }

    return same;
}

function splitAndSend(delivery, file) {
    // TODO split file with David's script

    // Chunks are now in subdirectory - subdir
    var chunks = fs.readFileSync('subdir');
}

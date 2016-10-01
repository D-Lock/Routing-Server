var io = require('socket.io').listen(1337);
var dl = require('delivery');
var fs = require('fs');
var firebase = require('firebase');

// Get reference to firebase database
var config = {
    apiKey: 'AIzaSyD--ACvhpg6AtGFXhdKwMgn8Lv8Q2oMTT4',
    authDomain: 'd-lock.firebaseapp.com',
    databaseURL: 'https://d-lock.firebaseio.com'
};
firebase.initializeApp(config);
var database = firebase.database();

var connections = {};

io.on('connection', function (socket) {
    var self = this;
    var email = "";
    var mac = "";

    // Handle new connections
    socket.on('user.info', function (user) {
        // Store details for this connection
        self.email = user.email;
        self.mac = user.mac;

        // Update connections dictionary
        if (user.email in connections) {
            connections[user.email].push(user.email);
        }
        else {
            connections.push({
                key: user.email,
                value: user.mac
            });
        }
    });

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
        // Ensure that we are connected
        checkMACs(socket, self.email)
    });

});

function checkMACs(socket, email) {
    //L
}

function splitAndSend(delivery, file) {

}

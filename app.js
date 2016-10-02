var io = require('socket.io').listen(1337);
var dl = require('delivery');
var fs = require('fs');
var firebase = require('firebase');
var crypto = require('crypto');
var spawn = require('child_process').spawn;

// Authenticate with firebase
var config = {
    apiKey: 'AIzaSyD--ACvhpg6AtGFXhdKwMgn8Lv8Q2oMTT4',
    authDomain: 'd-lock.firebaseapp.com',
    databaseURL: 'https://d-lock.firebaseio.com'
};
firebase.initializeApp(config);

var connections = {}; // id :
var users = {};

io.on('connection', function (socket) {
    console.log("User has connected");

    // Process user info
    socket.on('user.info', function (newUser) {
        // Store details for this connection
        users[socket.id] = newUser;


        var newConn = {
            user: newUser,
            socket: socket
        };
        console.log(newConn.user);

        if (newUser.id in connections) {
            connections[newUser.id].push(newConn);
        }
        else {
            connections[newUser.id] = [newConn];
        }
    });

    // TODO handle disconnect - remove MAC from connections

    // Listen for incoming for files
    var delivery = dl.listen(socket);
    delivery.on('receive.success', function (file) {

        console.log("Received file"); // DEBUG

        var params = file.params;
        fs.writeFile("downloads/" + file.name, file.buffer, function (err) {
            if (err) {
                console.log('Could not write initial data file');
            }
            else {
                console.log('File saved');

                // Load the data and act accordingly
                firebase.database().ref('clients').child(users[socket.id].id).once('value').then(function (snapshot) {
                    var val = snapshot.val();
                    var refmacs = Object.keys(val.all).map(function (key) {
                        return val.all[key];
                    });
                    console.log("Refmacs: ", refmacs); // DEBUG
                    if (checkMAC(users[socket.id].id, refmacs)) {
                        distribute(users[socket.id], socket, file);
                    }
                }).catch(function (err) {
                    console.log(err); // DEBUG
                });
            }
        });

    });
});


// 'socket' is the connection that send the file to the server
function distribute(user, socket, file) {

    // TODO split file with David's script and deposit chunks in a dir - subdir

    var userConnects = connections[user.id];

    // DEBUG
    console.log("USER INFO");
    console.log(userConnects);
    console.log(connections);
    console.log(user);

    var process = spawn('python', ["Tools/split_file.py", "downloads/" + file.name, userConnects.length, "-o",
        "downloads/temp/split.txt"]);

    process.on('close', function (code) {
        console.log(file.name); // DEBUG
        console.log(userConnects.length); // DEBUG

        var chunks = fs.readdirSync('downloads/temp');

        console.log("Chunk names: ", chunks); // DEBUG

        // Check if MAC number matches chunks
        if (chunks.length != userConnects.length) {
            socket.emit('error.mac.num', {errorMessage: "Number of chunks did not match number of MAC addresses"})
            console.error('error.mac.num')
            return;
        }

        // Generate the hash for the filename
        var hash = crypto.createHash('md5').update(file.name).digest('hex'); // FIXME how to ensure consistency in file name

        // Send chunks
        for (i = 0; i < chunks.length; i++) {
            console.log("USER CONNECTS"); // DEBUG
            console.log(userConnects); // DEBUG

            var delivery = dl.listen(userConnects[i].socket);
            delivery.connect();
            delivery.on('delivery.connect', function (delivery) {
                console.log("Delivery connected"); // DEBUG

                // DEBUG
                delivery.on('send.start', function (file) {
                    console.log("Sending Started");
                });

                // Try to send
                delivery.send({
                    name: chunks[i],
                    path: "downloads/temp/" + chunks[i]
                });

                // If success, store routing info in database
                delivery.on('send.success', function (uid) {
                    console.log("Succesful send"); // DEBUG
                    firebase.database().ref('routing/' + hash).child(userConnects[i].user.mac).set(chunks[i]);
                });
            })
        }

        // TODO check if the hash for the file name has the same amount of children as mac addresses
    });

}

function checkMAC(id, referenceMACs) {

    var active = connections[id].map(function (conn) {
        return conn.user.mac
    });

    // Check if active and reference are the same
    same = true;
    for (i = 0; i < referenceMACs.length; i++) {
        if (active.indexOf(referenceMACs[i]) === -1) {
            same = false
        }
    }

    return same;
}

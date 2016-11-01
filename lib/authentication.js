'use strict';

module.exports = {
  /** Stores the user information for the current sockets */
  users: {},

  /**
   * Removes a user from the list
   * @param {Object} socket - The socket of the user
   */
  removeUserBySocket: function(socket) {
    if(this.isAuthenticated(socket)) {
      delete this.users[socket.id];
    }
  },

  /**
   * Adds a user to the list
   * @param {Object} user - The new user to add to the list
   * @param {Object} socket - The socket to associate with the user
   */
  addUserSocket: function(user, socket) {
    this.users[socket.id] = user;
  },

  /**
   * Determine whether a given socket has authenticated
   * @param {Object} socket - The socket to check for authentication
   */
  isAuthenticated: function(socket) {
    return socket.id in this.users;
  },

  /**
   * Gets a user who is identified by their socket
   * @param {Object} socket - The socket of the user
   */  
  getUserBySocket: function(socket) {
    if(!(socket.id in this.users)) {
      throw new ReferenceError('Cannot find user with given socket');
    }

    return this.users[socket.id];
  },
  /**
   * Checks to make sure all MAC addresses are connected
   * @param {string} id - The user's ID
   * @param {string[]} referenceMACs - The MAC address list to compare to
   */
  checkMAC: function(connections, referenceMACs) {
    var active = connections.map(function (conn) {
      return conn.user.mac
    });

    // Check if active and reference are the same
    for (let i = 0; i < referenceMACs.length; i++) {
      if (active.indexOf(referenceMACs[i]) === -1) {
        return false;
      }
    }

    return true;
  }
};
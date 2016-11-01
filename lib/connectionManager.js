'use strict';

const authentication = require('./authentication.js');

module.exports = {
  /** Stores the connection information for all the sockets */
  connections: {},

  /**
   * Adds a user connection to the list
   * @param {Object} user - The user to add a connection to
   * @param {Object} connection - The new connection to associate with the user
   */
  addUserConnection: function(user, connection) {
    if (user.id in this.connections) {
      this.connections[user.id].push(connection);
    }
    else {
      this.connections[user.id] = [connection];
    }
  },


  /**
   * Removes a users connection by the given socket
   * @param {Object} user - The user to remove the socket from
   * @param {Object} socket - The socket of the connection to remove
   */
  removeConnectionBySocket: function(user, socket) {
    this.connections[user.id] = this.getConnections(user)
      .filter(function(connection) {
      return connection.socket === socket;
    });
  },

  /**
   * Gets all connections for a given user
   * @param {Object} user - The user associated with the connections
   */
  getConnections: function(user) {
    if(!(user.id in this.connections)) {
      throw new ReferenceError('No connections for the given user');
    }

    return this.connections[user.id];
  }
};
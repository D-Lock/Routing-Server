'use strict';

module.exports = {
  /** Stores the client information for the current sockets */
  clients: {},

  /**
   * Adds a client to the list
   * @param {Object} client - The new client to add to the list
   * @param {Object} socket - The socket to associate with the client
   */
  addClientSocket: function(client, socket) {
    this.clients[socket.id] = client;
  },

  /**
   * Removes a client from the list
   * @param {Object} socket - The socket of the client
   */
  removeClientBySocket: function(socket) {
    if(this.isAuthenticated(socket)) {
      delete this.clients[socket.id];
    }
  },

  /**
   * Determine whether a given socket has authenticated
   * @param {Object} socket - The socket to check for authentication
   */
  isAuthenticated: function(socket) {
    return socket.id in this.clients;
  },

  /**
   * Gets a client who is identified by their socket
   * @param {Object} socket - The socket of the client
   */  
  getClientBySocket: function(socket) {
    if(!(socket.id in this.clients)) {
      throw new ReferenceError('Cannot find client with given socket');
    }

    return this.clients[socket.id];
  }
};
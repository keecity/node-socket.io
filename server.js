'use strict';

const express = require('express');
const socketIO = require('socket.io');

const PORT = process.env.PORT || 3000;
const INDEX = '/index.html';

const server = express()
  .use('/assets', express.static(__dirname + '/assets'))
  .get('/planet', (req, res) => res.sendFile('/planet.html', { root: __dirname }))
  .get('/powerplant', (req, res) => res.sendFile('/powerplant.html', { root: __dirname }))
  .use((req, res) => res.sendFile(INDEX, { root: __dirname }))
  .listen(PORT, () => console.log(`Listening on ${PORT}`));

const io = socketIO(server);

let users = [];

io.on('connection', (socket) => {
  console.log('Client connected');
  socket.on('disconnect', () => {
    users = users.filter(x => x.userID !== socket.id);
    console.log('Client disconnected')
    io.sockets.emit("users", users);
  });
  socket.on('callUserName', (data) => {
    users.forEach(u => {
      if (u.username == data.username ) {
        io.to(u.userID).emit('newMessage', data.message);
      }
    })
  });
  // for (let [id, socket] of io.of("/").sockets) {
  // }
  var cUserName = socket.handshake.query.username;
  users.push({
    userID: socket.id,
    username: cUserName,
  });
  // socket.emit("users", users);
  socket.join(cUserName);
  io.sockets.emit("users", users);
});

// setInterval(() => io.emit('time', new Date().toTimeString()), 1000);

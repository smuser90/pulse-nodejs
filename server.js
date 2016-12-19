var server = require('http').createServer();
var io = require('socket.io')(server);
var ss = require('socket.io-stream');
var path = require('path');
var fs = require('fs');
var PORT = 80;

io.on('connection', function(socket) {
  console.log("Connection succesful!");
  var timeStart = Date.now();
  socket.on('push-photo', function(data){
    console.log("got photo push");
    console.dir(data.fd);
    var transmitTime = Date.now() - timeStart;
    console.log("Transmit time: "+transmitTime+"ms");

    socket.emit('push-photo-success');
  });

  socket.on('disconnect', function(){
    console.log("Client disconnected");
  });
});

server.listen(PORT, function() {
    console.log('Alpine TestServer online. \nListening on port: ' + PORT + '\n');
});

var server = require('http').createServer();
var io = require('socket.io')(server);
var ss = require('socket.io-stream');
var path = require('path');
var fs = require('fs');
var PORT = 80;
var CLIENT;
  var timeStart = Date.now();
  var transmitTime = Date.now() - timeStart;


const readline = require('readline');
readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
process.stdin.on('keypress', (str, key) => {
  if (key.ctrl && key.name === 'c') {
    console.log("Goodbye");
    process.exit();
  }

  if (key.name === 'p') {
    timeStart = Date.now();
    console.log("Capturing photo");
    CLIENT.emit('photo-capture');
  }

  if (key.name === 'c') {
    console.log("Triggering capture");
    CLIENT.emit('trigger');
  }
});

io.on('connection', function(socket) {
  console.log("Connection succesful!");

  CLIENT = socket;


  socket.on('push-photo', function(data){
    console.log("got photo push");
    transmitTime = Date.now() - timeStart;
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

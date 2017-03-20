const spawn = require('child_process').spawn;
const ss = require('socket.io-stream');
const fs = require('fs');
const stream = ss.createStream();

const gphoto2 = require('gphoto2');
const GPhoto = new gphoto2.GPhoto2();

const CHUNK_SIZE = 102400;

var express = require('express');
var app = express();

app.get('/', function(req, res){
  res.send('Hello Alpine!');
});

var frameResponse;
app.get('/frame', function(req, res){
  frameResponse = res;
  gphotoLiveView();
});

var socketPath = '/run/sock1.sock';
var net = require('net');

var camera;
var buffer;


fs.stat(socketPath, function(err) {
    if (!err) fs.unlinkSync(socketPath);
    var unixServer = net.createServer(function(localSerialConnection) {
        localSerialConnection.on('data', function(data) {
						buffer = data;
						sendPhoto(0);
            // data is a buffer from the socket
        });
        // write to socket with localSerialConnection.write()
    });

	unixServer.listen(socketPath, function(err, path){
		if(!err){
		console.log("IPC Server started!");
		}
	});
});


GPhoto.list(function (list) {
	if(list.length === 0){
		console.log("No camera found!");
		process.exit(1);
	}
	camera = list[0];
	// Save pictures to sd card instead of RAM
	camera.setConfigValue('capturetarget', 1, function (er) {});
});

const socket = require('socket.io-client')('http://10.1.10.124:1025');
var filename = 'photo.jpg';

var start, end;

function gphotoLiveView(){
	camera.takePicture({
	    preview: true
	  }, function (er, tmpname) {
				frameResponse.send(fs.readFileSync(tmpname));
	  });
}

function gphotoCapture(){
	camera.takePicture({
	    targetPath: '/foo.XXXXXX'
	  }, function (er, tmpname) {
			buffer = fs.readFileSync(tmpname);
			sendPhoto(0);
	  });
}

socket.on('connect', function(){
	console.log(Date.now()+": Connected to client. Awaiting commands...");
});

socket.on('capture-photo', function(){
	console.log(Date.now()+": Initiating photo capture...");
	gphotoCapture();
});

socket.on('live-view-frame', function(){
	gphotoLiveView();
});

var sendPhoto = function(packet){
	// console.log(Date.now()+": Pushing photo...");
	var fileData = buffer;
	var packets = Math.floor(fileData.length / CHUNK_SIZE);
	if(fileData.length % CHUNK_SIZE){
		packets++;
	}

	var startIndex = packet * CHUNK_SIZE;
	socket.emit('push-photo', {
		packet: packet,
		packets: packets,
		fd: fileData.slice(startIndex, startIndex + CHUNK_SIZE)});
};

socket.on('push-photo-success', function(data){
	if(data.packet < data.packets - 1){
		sendPhoto(data.packet + 1);
	}else{
		socket.emit('push-photo-complete');
		console.log(Date.now()+": Photo push succesful\r\n");
		const rm = spawn('rm', ['./'+filename]);
	}
});

console.log("Initialization complete. Looking for client...");

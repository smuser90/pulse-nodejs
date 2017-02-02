const spawn = require('child_process').spawn;
const fs = require('fs');
const gphoto2 = require('gphoto2');
const GPhoto = new gphoto2.GPhoto2();

const CHUNK_SIZE = 30720;

var socketPath = '/run/sock1.sock';
var net = require('net');

var camera;
var buffer;

var burst = 0;

fs.stat(socketPath, function(err) {
    if (!err) fs.unlinkSync(socketPath);
    var unixServer = net.createServer(function(localSerialConnection) {
        localSerialConnection.on('data', function(data) {
						if(burst === 0){
							buffer = data;
						}else{
							buffer = Buffer.concat([buffer, data]);
						}
						burst++;
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

const socket = require('socket.io-client')('http://192.168.2.1:1025', {httpCompression: false});
var filename = 'photo.jpg';

var start, end;

function gphotoLiveView(){
	console.log(Date.now()+": Getting frame");
	camera.takePicture({
	    preview: true,
	    targetPath: '/foo.XXXXXX'
	    //socket: socketPath
	  }, function (er, tmpname) {
				// Data is coming through IPC not callback
		if(er){
			console.log("Error: "+er);
		}else{
			console.log(Date.now()+": Got frame - "+tmpname);
			buffer = fs.readFileSync(tmpname);
			sendPhoto(0);
			//gphotoLiveView();
		}
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
	console.log(Date.now()+": Getting Frame");
	gphotoLiveView();
});

var sendPhoto = function(packet){
	console.log(Date.now()+ ": send photo chunk "+packet);
	burst = 0;
	var fileData = buffer;
	var packets = Math.floor(fileData.length / CHUNK_SIZE);
	if(fileData.length % CHUNK_SIZE){
		packets++;
	}

	var startIndex = packet * CHUNK_SIZE;
	var dat = fileData.slice(startIndex, startIndex + CHUNK_SIZE);
	console.log(Date.now()+ ": after slice");
	console.log("length: "+dat.length);
	socket.emit('push-photo', {
		packet: packet,
		packets: packets,
		fd: dat
	});
};

socket.on('push-photo-success', function(data){
	if(data.packet < data.packets - 1){
		sendPhoto(data.packet + 1);
	}else{
		socket.emit('push-photo-complete');
		console.log(Date.now()+": Photo push succesful\r\n");
		// const rm = spawn('rm', ['./'+filename]);
		gphotoLiveView();
	}
});

console.log("Initialization complete. \r\nScanning for client...");

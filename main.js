const spawn = require('child_process').spawn;
const ss = require('socket.io-stream');
const fs = require('fs');
const stream = ss.createStream();

const gphoto2 = require('gphoto2');
const GPhoto = new gphoto2.GPhoto2();

const CHUNK_SIZE = 102400;

var camera;

GPhoto.list(function (list) {
	camera = list[0];
});

const socket = require('socket.io-client')('http://10.1.10.231:1025');
var filename = 'photo.jpg';

var start, end;

function gphotoCapture(){
	// const gphoto = spawn('gphoto2', ['--capture-image-and-download', '--debug', '--filename=./'+filename]);
	//
	// gphoto.stdout.on('data', (data) => {
	//
	// 	if(data.includes("New file is in location")){
	// 		console.log(Date.now()+": Photo added to camera SD");
	// 	}
	// 	else if(data.includes("Deleting file")){
	// 		console.log(Date.now()+": Photo added to Pulse rootfs");
	// 	}
	// 	else if(data.includes("Saving file as")){
	// 		console.log(Date.now()+": Saving photo to Pulse");
	// 	}else {
	// 		console.log(`stdout: ${data}`);
	// 	}
	// });
	//
	// gphoto.stderr.on('data', (data) => {
	// 	if(data.includes("gp_port_open")){
	// 		console.log(Date.now()+": Opened ptp port");
	// 	}
	//
	// 	if(data.includes("PTP_OC_NIKON_InitiateCaptureRecInMedia")){
	// 		console.log(Date.now()+": Sending capture command")
	// 	}
	//   // console.log(`stderr: ${data}`);
	// });
	//
	// gphoto.on('close', (code) => {
	//   console.log(Date.now()+`: gphoto2 exited with code: ${code}`);
	// 	if(code === 0){
	// 		console.log("Starting photo transfer");
	// 		sendPhoto(0);
	// 	}else{
	// 		console.log(Date.now()+": There was a problem capturing the photo");
	// 	}
	// });

	camera.takePicture({
    targetPath: '/tmp/foo.XXXXXX'
  }, function (er, tmpname) {
    fs.renameSync(tmpname, __dirname + '/'+filename);
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

var sendPhoto = function(packet){
	// console.log(Date.now()+": Pushing photo...");
	var fileData = fs.readFileSync(`./${filename}`);
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
		const rm = spawn('rm', [`./${filename}`]);
	}
});

console.log("Initialization complete. Looking for client...");

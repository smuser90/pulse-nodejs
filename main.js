const spawn = require('child_process').spawn;
const ss = require('socket.io-stream');
const fs = require('fs');
const stream = ss.createStream();

const socket = require('socket.io-client')('http://10.1.10.231:1025');
var filename = 'photo.jpg';

var start, end;

function gphotoCapture(){
	const gphoto = spawn('gphoto2', ['--capture-image-and-download', '--filename=./'+filename]);

	gphoto.stdout.on('data', (data) => {

		if(data.includes("New file is in location")){
			console.log(Date.now()+": Photo added to camera SD");
		}
		else if(data.includes("Deleting file")){
			console.log(Date.now(+": Photo added to Pulse rootfs")
		}else {
			console.log(`stdout: ${data}`);
		}
	});

	gphoto.stderr.on('data', (data) => {
	  console.log(`stderr: ${data}`);
	});

	gphoto.on('close', (code) => {
	  console.log(Date.now()+`: gphoto2 exited with code: ${code}`);
		if(code === 0){
			sendPhoto();
		}else{
			console.log(Date.now()+": There was a problem capturing the photo");
		}
	});
}

socket.on('connect', function(){
	console.log(Date.now()+": Connected to client. Awaiting commands...");
});

socket.on('capture-photo', function(){
	console.log(Date.now()+": Initiating photo capture...");
	gphotoCapture();
});

var sendPhoto = function(){
	console.log(Date.now()+": Pushing photo...");
	var fileData = fs.readFileSync(`./${filename}`);
	socket.emit('push-photo', {fd: fileData});
};

socket.on('push-photo-success', function(){
	console.log(Date.now()+": Photo push succesful\r\n");
	const rm = spawn('rm', [`./${filename}`]);
});

console.log("Initialization complete. Looking for client...");

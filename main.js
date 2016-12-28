const spawn = require('child_process').spawn;
const ss = require('socket.io-stream');
const fs = require('fs');
const stream = ss.createStream();

const socket = require('socket.io-client')('http://10.1.10.231:1025');
var filename = 'photo.jpg';

socket.on('connect', function(){

	const gphoto = spawn('gphoto2', ['--capture-image-and-download', '--filename ./photo.jpg']);

	gphoto.stdout.on('data', (data) => {
		console.log(`stdout: ${data}`);
	});

	gphoto.stderr.on('data', (data) => {
	  console.log(`stderr: ${data}`);
	});

	gphoto.on('close', (code) => {
	  console.log(`gphoto2 exited with code: ${code}`);
		if(code === 0){
			sendPhoto();
		}else{
			console.log("There was a problem capturing the photo");
		}
	});
});

var sendPhoto = function(){
	var fileData = fs.readFileSync(`./${filename}`);
	socket.emit('push-photo', {fd: fileData});
};

socket.on('push-photo-success', function(){
	const rm = spawn('rm', [`./${filename}`]);
});

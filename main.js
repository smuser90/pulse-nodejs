var spawn = require('child_process').spawn;
var Q = require('q');
var ss = require('socket.io-stream');
var fs = require('fs');
var stream = ss.createStream();

var gphoto2 = require('gphoto2');
var GPhoto = new gphoto2.GPhoto2();

var CHUNK_SIZE = 102400;

var socketPath = '/run/sock1.sock';
var net = require('net');

var camera;
var buffer;

var tlObject = {
  interval: 1000, // ms
  photos: 5
};

var listCameras = function(){
  var deferred = Q.defer();
  console.log('Getting list of cameras...');
  GPhoto.list(function (list) {
  	if(list.length === 0){
  		console.log("No camera found! Exiting...");
  		process.exit(1);
  	}
  	camera = list[0];
  	// Save pictures to sd card instead of RAM
    deferred.resolve(camera);
  });
  return deferred.promise;
};

var setCameraStorage = function(cam, storage){
  var deferred = Q.defer();
  console.log('Setting camera storage to '+storage);
  cam.setConfigValue('capturetarget', storage, function (er) {
    if(er){
      deferred.reject(er);
    }else{
      deferred.resolve();
    }
  });
  return deferred.promise;
};

listCameras().then(function(cam){
  setCameraStorage(cam, 1);
});

var socket = require('socket.io-client')('http://10.1.10.124:1025');
var filename = 'photo.jpg';

var start, end;

function gphotoLiveView(){
	camera.takePicture({
	    preview: true,
	    socket: socketPath
	  }, function (er, tmpname) {
				// Data is coming through IPC not callback
	  });
}

function gphotoCapture(dontSend){
  camera.setConfigValue('capturetarget', 1, function(){
    camera.takePicture({
      download: false
  	    // targetPath: '/foo.XXXXXX'
  	  }, function (er, tmpname) {
      if(er){
        console.log("Capture error: "+er);
      }else{
          console.log("tmpname: "+tmpname);
			    //  buffer = fs.readFileSync(tmpname);
           if(!dontSend){
			          sendPhoto(0);
           }
           tlObject.photos--;
      }
  	});
  });

}

function timelapseStep(){
  setTimeout(function(){
    console.log("Stepping TL... "+tlObject.photos);

    gphotoCapture(true);
    if(tlObject.photos > 1){
      timelapseStep();
    }
  }, tlObject.interval);
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

socket.on('timelapse', function(tl){
  if(tl && tl.interval){
    tlObject.interval = tl.interval;
    tlObject.photos = tl.photos;
  }
  console.log("Received timelapse packet!");
  console.dir(tl);
  timelapseStep();
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
		var rm = spawn('rm', ['./'+filename]);
	}
});


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

console.log("Initialization complete. Looking for client...");

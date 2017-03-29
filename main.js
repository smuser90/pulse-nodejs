console.log("* Pulse Pro Startup *");

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

var socket = require('socket.io-client')('http://192.168.1.11:1025');
var filename = 'photo.jpg';

var start, end;

var tlObject = {
	interval: 1000, // ms
	photos: 5,
  running: false,
  startPhoto: Date.now(),
  endPhoto: Date.now(),
  tlDirectory: './'
};

var hdrObject = {
  evPerStep: 1,
  steps: 5,
  currentStep: 1
};

var app = require('express')();

app.get('/', function(req, res){
  res.send('Hello Alpine!');
});

var frameResponse;
app.get('/frame', function(req, res){
  frameResponse = res;
  gphotoLiveView();
});

var captureResponse;
app.get('/capture', function(req, res){

});

app.listen(80, function() {
	console.log('http stream server is running on port 80');
});

var getCamera = function() {
	var deferred = Q.defer();
	console.log('Getting list of cameras...');
	GPhoto.list(function(list) {
		if (list.length === 0) {
			console.log("No camera found! Exiting...");
			process.exit(1);
		}
		camera = list[0];
		// Save pictures to sd card instead of RAM
		deferred.resolve(camera);
	});
	return deferred.promise;
};

var setCameraStorage = function(cam, storage) {
	var deferred = Q.defer();
	console.log('Setting camera storage to ' + storage);
	cam.setConfigValue('capturetarget', storage, function(er) {
		if (er) {
			deferred.reject(er);
		} else {
			deferred.resolve();
		}
	});
	return deferred.promise;
};

var getCameraSettings = function(){
  var deferred = Q.defer();
  console.log("Getting camera shutter setting...");
  camera.getConfig(
    function(er, settings){

      camSettings = settings.main.children;
      deferred.resolve(settings.main.children);
    }
  );
  return deferred.promise;
};

var camSettings;
var hdrPhoto = function(photos){
  console.log("HDR Photo: "+photos);
  var shutterSettings = camSettings.capturesettings.children.shutterspeed2.choices;
  var currentShutter = camSettings.capturesettings.children.shutterspeed2.value;
  if(photos > 0){
    console.log("Shutter is: "+currentShutter);
    var ev = calculateEV(shutterSettings);
    var indexStep = hdrObject.evPerStep / ev;

    setCameraSetting('shutterspeed2', shutterSettings[shutterSettings.indexOf(currentShutter)+indexStep]).then(
      function(){
        gphotoCapture().then(function(){
          getCameraSettings().then(
            function(){
              hdrPhoto(photos-1);
            }
          );
        });
      }
    );
  }
};

var calculateEV = function(shutterSettings){
  var firstIndex = shutterSettings.indexOf("30");
  var secondIndex = shutterSettings.indexOf("15");
  var steps;
  if(firstIndex > secondIndex){ steps = firstIndex - secondIndex; }
  else{ steps = secondIndex - firstIndex; }

  return 1 / steps;
};

var downloadImage = function(source, destination){
  var deferred = Q.defer();
  camera.downloadPicture(
    {
      cameraPath: source,
      targetPath: destination ? destination : '/tmp/foo.XXXXXX'
    },
    function(er, fileString){
      if(er){
        console.log('Error saving photo to PPro: '+er);
        deferred.reject(er);
      }else{
        deferred.resolve(fileString);
      }
    }
  );

  return deferred.promise;
};


var setCameraSetting = function(setting, value){
  var deferred = Q.defer();
  console.log('Setting camera '+setting+' to '+value);
  camera.setConfigValue(setting, value, function(er){
    if(er){
      console.log('Error setting '+setting+' to '+value+' : '+er);
      deferred.reject(er);
    }else{
      deferred.resolve();
    }
  });

  return deferred.promise;
};

var gphotoLiveView = function gphotoLiveView() {
	camera.takePicture({
		preview: true,
		targetPath: '/foo.XXXXXX'
	}, function (er, tmpname) {
  if(er){
    gphotoLiveView();
  }else{
    frameResponse.send(fs.readFileSync(tmpname));
    fs.unlinkSync(tmpname);
  }
  });
};

var gphotoCapture = function gphotoCapture() {
  var deferred = Q.defer();
      tlObject.startPhoto = Date.now();
      camera.takePicture({
  			download: false
  		}, function(er, tmpname) {
  			if (er) {
  				console.log("Capture error: " + er);
          gphotoCapture();
  			} else {
  				console.log("Storage Location: " + tmpname);
          tlObject.endPhoto = Date.now();
  				tlObject.photos--;
          if (tlObject.photos === 0) {
      			tlObject.running = false;
            console.log("Timelapse complete!      :D");
      		}
          if(tlObject.running){
            timelapseStep();
          }
          deferred.resolve(tmpname);
  			}
  		});

  return deferred.promise;
};

function timelapseStep() {
  var waitTime;
  var elapsed = tlObject.endPhoto - tlObject.startPhoto;
  if(elapsed > tlObject.interval){
    waitTime = 1; // It's go time;
  }else{
    waitTime = tlObject.interval - elapsed;
    console.log("Elapsed time was: "+elapsed+"ms\nWaiting "+waitTime+"ms for next photo");
  }
	setTimeout(function() {
		console.log("Stepping TL... " + tlObject.photos);
		gphotoCapture().then(function(photoPath){
      downloadImage(photoPath, tlObject.tlDirectory+'/'+tlObject.photos);
    });
	}, waitTime);
}

socket.on('connect', function() {
	console.log(Date.now() + ": Connected to client. Awaiting commands...");
});

socket.on('capture-photo', function() {
	console.log(Date.now() + ": Initiating photo capture...");
	gphotoCapture();
});

socket.on('live-view-frame', function() {
	gphotoLiveView();
});

socket.on('timelapse', function(tl) {
  tlObject.tlDirectory = './timelapse'+Date.now();

  if(!fs.existsSync(tlObject.tlDirectory)){
    fs.mkdirSync(tlObject.tlDirectory);
  }

	if (tl && tl.interval) {
		tlObject.interval = tl.interval;
		tlObject.photos = tl.photos;
    tlObject.running = true;
	}
	console.log("Received timelapse packet!");
	console.dir(tl);
	gphotoCapture();
});

var sendPhoto = function(packet) {
	var fileData = buffer;
	var packets = Math.floor(fileData.length / CHUNK_SIZE);
	if (fileData.length % CHUNK_SIZE) {
		packets++;
	}

	var startIndex = packet * CHUNK_SIZE;
	socket.emit('push-photo', {
		packet: packet,
		packets: packets,
		fd: fileData.slice(startIndex, startIndex + CHUNK_SIZE)
	});
};

socket.on('push-photo-success', function(data) {
	if (data.packet < data.packets - 1) {
		sendPhoto(data.packet + 1);
	} else {
		socket.emit('push-photo-complete');
		console.log(Date.now() + ": Photo push succesful\r\n");
		var rm = spawn('rm', ['./' + filename]);
	}
});


fs.stat(socketPath, function(err) {
	if (!err) fs.unlinkSync(socketPath);
	var unixServer = net.createServer(function(localSerialConnection) {
		localSerialConnection.on('data', function(data) {
			buffer = data;
			sendPhoto(0);
		});
	});

	unixServer.listen(socketPath, function(err, path) {
		if (!err) {
			console.log("IPC Server started!");
		}else{
      console.log("Error starting IPC Server!");
    }
	});
});

console.log("Init complete. Running...");
getCamera().then(function(cam) {
	setCameraStorage(cam, 1).then(
    function(){
      getCameraSettings().then(function(){
        hdrPhoto(hdrObject.steps);
      });
    });
  }
);

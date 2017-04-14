console.log("* Pulse Pro Startup *");

process.on('uncaughtException', function (error) {
    console.log("Uncaught Exception: "+error);
});

var mv = require('mv');
var epeg = require('epeg');

var imageSize = require('image-size');

var spawn = require('child_process').spawn;
var exec = require('child_process').exec;

var Q = require('q');
var ss = require('socket.io-stream');
var fs = require('fs');
var sysInit = require('./sys_init');

var stream = ss.createStream();

var gphoto2 = require('gphoto2');
var GPhoto;

var TL_PREVIEW_FPS = 24;

var socketPath = '/run/sock1.sock';
var net = require('net');

var camera;
var buffer;

var socket = require('socket.io-client')('http://192.168.1.100:1025');
// var socket = require('socket.io-client')('http://10.1.10.124:1025');
var filename = 'photo.jpg';

var start, end;
var compressionFactor = 10;
var compressionFactorTL = 10;

var tlObject = {
	interval: 1000, // ms
	photos: 5,
  total: 5,
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
var routes = require('./expressRoutes');
routes.initRoutes(app, fs, spawn, camera, gphotoLiveView, gphotoCapture, downloadImage, gphotoInit, downsize);

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
      console.log('Error setting camera storage: '+er);
			deferred.reject(er);
		} else {
			deferred.resolve();
		}
	});
	return deferred.promise;
};

var downsize = function(imagePath, factor){
  var dimensions = imageSize(imagePath);
  console.log("Downsizing image "+imagePath+"\n"+"Image Size: "+dimensions.width+' x '+dimensions.height);
  var image = new epeg.Image({path: imagePath});
  var downres = image.downsize(dimensions.width / factor, dimensions.height / factor, 85);
  fs.unlinkSync(imagePath);
  downres.saveTo(imagePath);
  console.log("Finished downsize");
  return downres;
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
  console.log("Downloading Image from camera: "+source+ " to destination: " + destination);
  camera.downloadPicture(
    {
      cameraPath: source,
      keepOnCamera: true,
      targetPath: '/tmp/foo.XXXXXX'
    },
    function(er, fileString){
      if(er){
        console.log('Error saving photo to PPro: '+er);
        deferred.reject(er);
      }else{
        mv(fileString, destination, function(err){
          if(err){
            console.log("Error moving file: "+err);
            deferred.reject();
          }else{
            console.log(fileString + " succesfully moved to " + destination);
            deferred.resolve(destination);
          }
        });

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

var gphotoLiveView = function gphotoLiveView(res) {
	camera.takePicture({
		preview: true,
		targetPath: '/foo.XXXXXX'
	}, function (er, tmpname) {
    if(er){
      gphotoLiveView();
    }else{
      if(compressionFactor > 1){
        downsize(tmpname, compressionFactor);
      }
      res.send(fs.readFileSync(tmpname));
      fs.unlinkSync(tmpname);
    }
  });
};

var gphotoCapture = function gphotoCapture() {
  console.log("Capturing Photo");
  var deferred = Q.defer();
      tlObject.startPhoto = Date.now();
      camera.takePicture({
        download: false,
        keepOnCamera: true,
  			// targetPath: '/foo.XXXXXX'
  		}, function(er, tmpname) {
  			if (er) {
  				console.log("Capture error: " + er);
          gphotoCapture();
  			} else {
  				console.log("Storage Location: " + tmpname);
          deferred.resolve(tmpname);
  			}
  		});

  return deferred.promise;
};

function timelapseStep(first) {
  var waitTime;
  var elapsed = tlObject.endPhoto - tlObject.startPhoto;
  if(elapsed > tlObject.interval || first){
    waitTime = 1; // It's go time;
  }else{
    waitTime = tlObject.interval - elapsed;
    console.log("Elapsed time was: "+elapsed+"ms\nWaiting "+waitTime+"ms for next photo");
  }
	setTimeout(function() {
		console.log("Stepping TL... " + tlObject.photos);
		gphotoCapture().then(
      function(photoPath){
        var metaData = {
          cameraSource: photoPath
        };
        var destination = tlObject.tlDirectory+'/'+(tlObject.total-tlObject.photos)+'.jpg';
        downloadImage(photoPath, destination).then(
          function(){
            downsize(destination, compressionFactorTL);
            fs.writeFile(tlObject.tlDirectory+'/'+(tlObject.total-tlObject.photos)+'-meta.txt', JSON.stringify(metaData));
            if(tlObject.running){
              tlObject.endPhoto = Date.now();
      				tlObject.photos--;
              if (tlObject.photos < 0) {
          			tlObject.running = false;
                console.log("Timelapse complete!      :D");
          		}

              if(tlObject.running){
                timelapseStep();
              }
            }
          }
        );
      }
    );
	}, waitTime);
}

socket.on('connect', function() {
	console.log(Date.now() + ": Connected to client. Awaiting commands...");
});

socket.on('capture-photo', function() {
	console.log(Date.now() + ": Initiating photo capture...");
	gphotoCapture();
});

socket.on('get-configs', function() {
  camera.getConfig(
    function(er, settings){
      if(!er){
        socket.emit('send-configs', settings);
      }else{
        console.log("Error getting configs: "+settings);
      }
    }
  );
});

socket.on('set-config', function(config, value){
  console.log("Rx'd set config: "+config+' '+value);
  camera.setConfigValue(config, value, function(er){
    if(er){
      console.log('Error setting '+config+' to '+value+' : '+er);
    }else{
      socket.emit('ack-config', {config: config, value: value});
    }
  });
});

socket.on('compression-factor', function(cf){
  console.log("Compression factor updated to: "+cf);
  compressionFactor = cf;
});

socket.on('compression-factor-tl', function(cf){
  console.log("TL compression factor updated to: "+cf);
  compressionFactorTL = cf;
});

socket.on('hdr', function(hdr) {
	hdrObject.evPerStep = hdr.evPerStep / 3;
  hdrObject.steps = hdr.steps;
  hdrObject.currentStep = 1;
  hdrPhoto(hdrObject.steps);
});

socket.on('timelapse', function(tl) {
  tlObject.tlDirectory = __dirname+'/timelapses/tl'+Date.now();

  if(!fs.existsSync(tlObject.tlDirectory)){
    fs.mkdirSync(tlObject.tlDirectory);
  }

	if (tl && tl.interval) {
		tlObject.interval = tl.interval;
		tlObject.photos = tl.photos;
    tlObject.total = tl.photos;
    tlObject.running = true;
	}
	console.log("Received timelapse packet!");
	console.dir(tl);
	timelapseStep(true);
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

if(!fs.existsSync('./timelapses')){
  fs.mkdirSync('./timelapses');
}

sysInit.sysInitSetup(Q, exec);
sysInit.startWifiAP();
if(!fs.existsSync('/swap')){
  sysInit.swapInit();
}

var gphotoInit = function(){
  GPhoto = undefined;
  GPhoto = new gphoto2.GPhoto2();
  getCamera().then(function(cam) {
  	setCameraStorage(cam, 1).then(
      function(){
        getCameraSettings().then(function(){
          // hdrPhoto(hdrObject.steps);
        });
      });
    }
  );
};

console.log("Init complete. Running...");
gphotoInit();

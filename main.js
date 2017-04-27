console.log("* Pulse Pro Startup *");

/*
  Catching uncaught exceptions will help the code continue to run in the event
  something bad happens
*/
process.on('uncaughtException', function (error) {
    console.log("Uncaught Exception: "+error);
});

/*
  Begin module imports
*/
var mv = require('mv'); //module to move files
var epeg = require('epeg'); //compression library for images
var imageSize = require('image-size'); // tells us how big an image is
//these are used to launch child processes

//things that will run for a while/whole time, and that we can modify on the fly
//ex : process image frames
var spawn = require('child_process').spawn;
//launch a single bash commands, like one-off gphoto commands
//limited to 256K of stdout buffer/output
var exec = require('child_process').exec;

var Q = require('q'); //promise library
var fs = require('fs');//file system
var sysInit = require('./sys_init'); //sys_init.js
var gphoto2 = require('gphoto2'); //node-gphoto wrapper
//sets up client w/ static IP address
//TODO longer term we need to switch us around so that we're always the server
var socket = require('socket.io-client')('http://192.168.1.101:1025');
// var socket = require('socket.io-client')('http://10.1.10.124:1025');

var net = require('net');//networking library, set up a posix server, but we don't use it currently
/*
  End module imports
*/

var camera;
var buffer;
var socketPath = '/run/sock1.sock';//we don't use it but minimal overhead and we may want it later
var compressionFactor = 10;
var compressionFactorTL = 10;//compression factor for TLs
var camSettings;//global for caching camera settngs
var GPhoto;

//this needs to sync up with client app objects
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

/*
  Run this to detect connected cameras.
*/
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

/*
  This sets the camera storage option.
  On every camera in the office setting this to 1 makes photos save to the SD card
  TODO move this to another file since it's a wrapper
*/
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

/*
   This function will downsize a jpeg by a factor specified by factor
   this will replace the original file with downressed version
*/
var downsize = function(imagePath, factor){
  var dimensions = imageSize(imagePath);
  console.log("Downsizing image "+imagePath+"\n"+"Image Size: "+dimensions.width+' x '+dimensions.height);
  var image = new epeg.Image({path: imagePath});
  //saves to 85% of original quality
  var downres = image.downsize(dimensions.width / factor, dimensions.height / factor, 85);
  fs.unlinkSync(imagePath);
  downres.saveTo(imagePath);
  console.log("Finished downsize");
  return downres;
};


/*
  Retrieves camera configs and assigns them to global camSettings variable
*/
var getCameraSettings = function(){
  var deferred = Q.defer();
  console.log("Getting camera settings...");
  camera.getConfig(
    function(er, settings){

      camSettings = settings.main.children;
      deferred.resolve(settings.main.children);
    }
  );
  return deferred.promise;
};

/*
  HDR step function
*/
var hdrPhoto = function(photos){
  console.log("HDR Photo: "+photos);
  //TODO sometimes the array we want is shutterspeed, so need to check if shutterspeed2 is defined
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

//returns if we're using 1/3, 1/2, or 1 eV steps
var calculateEV = function(shutterSettings){
  var firstIndex = shutterSettings.indexOf("30");
  var secondIndex = shutterSettings.indexOf("15");
  var steps;
  if(firstIndex > secondIndex){ steps = firstIndex - secondIndex; }
  else{ steps = secondIndex - firstIndex; }

  return 1 / steps;
};

/*
  Promised based wrapper to get an image from the camera's filesystem
*/
var downloadImage = function(source, destination){
  var deferred = Q.defer();
  console.log("Downloading Image from camera: "+source+ " to destination: " + destination);
  camera.downloadPicture(
    {
      cameraPath: source,
      keepOnCamera: true,
      targetPath: '/tmp/foo.XXXXXX'//will save to foo.[random 6 digit #]
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

var returnCamera = function(){
  return camera;
};

/*
 Promised based wrapper for setting camera configs
*/
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

/*
  Will retrieve a live view frame from the camera.
  Fails silently if not supported
  //TODO set a timeout the first time we call this, if nothing comes back assume it's not supported
  //TODO set us up so taht the client can stop the preview state. this wil have to come in at the nodegphoto module level prolly. or we could detach and restart the object like we do for files
*/
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

/*
  Promised based wrapper for node-gphoto's capture
  //TODO put limit to number of re-tries
*/
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


/*
  This is the step function for a timelapse.
  It sets a timeout to take the next picture based on the latency of the last picture.
*/
var timelapseStep = function timelapseStep(first) {
  var waitTime;
  var elapsed = tlObject.endPhoto - tlObject.startPhoto;
  if(elapsed > tlObject.interval || first){
    waitTime = 1; // last interval ran long, take photo immediately
  }else{ //compute remainder of interval
    waitTime = tlObject.interval - elapsed;
    console.log("Elapsed time was: "+elapsed+"ms\nWaiting "+waitTime+"ms for next photo");
  }
	setTimeout(function() {
		console.log("Stepping TL... " + tlObject.photos);
		gphotoCapture().then(
      //this tells us where the picture is on the camera SD card
      function(photoPath){
        var metaData = {
          cameraSource: photoPath
        };
        //where we want to put it on our fs
        var destination = tlObject.tlDirectory+'/'+(tlObject.total-tlObject.photos)+'.jpg';
        // Download the picture we just took and put it in the TL directory
        //TODO make this so we can turn off automatic TL image grabs
        downloadImage(photoPath, destination).then(
          function(){
            // Now lets downsize it to a 'thumbnail' based on the compressionFactor
            downsize(destination, compressionFactorTL);
            // Write the image-specific meta data file so we know which image on the camera file structure this came from.
            fs.writeFile(tlObject.tlDirectory+'/'+(tlObject.total-tlObject.photos)+'-meta.txt', JSON.stringify(metaData));

            // If the timelapse is still running
            if(tlObject.running){
              tlObject.endPhoto = Date.now();
      				tlObject.photos--;

              // Check to see if this was the last photo of the TL
              if (tlObject.photos < 0) {
          			tlObject.running = false;
                console.log("Timelapse complete!      :D");
          		}
              //if we're still going the recurse
              if(tlObject.running){
                timelapseStep();
              }
            }
          }
        );
      }
    );
	}, waitTime);
};

//TODO move socket wrappers into their own file
/*
  This is the connection callback. It doesn't do anything right now
*/
socket.on('connect', function() {
	console.log(Date.now() + ": Connected to client. Awaiting commands...");
});


/*
  Callback for the capture-photo command,
  This will only trigger a capture, not return the photo.
  If we want a photo back, do it over http
*/
socket.on('capture-photo', function() {
	console.log(Date.now() + ": Initiating photo capture...");
	gphotoCapture();
});


/*
  Will return the camera config object to the client
*/
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

/*
 Given a config and value, this function sets that on the camera
*/
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

/*
  Sets the compression factor for general images
*/

socket.on('compression-factor', function(cf){
  console.log("Compression factor updated to: "+cf);
  compressionFactor = cf;
});

/*
  Sets the compression factor for timelapse preview images
*/
socket.on('compression-factor-tl', function(cf){
  console.log("TL compression factor updated to: "+cf);
  compressionFactorTL = cf;
});

/*
  Command to trigger an HDR
*/
socket.on('hdr', function(hdr) {
	hdrObject.evPerStep = hdr.evPerStep / 3;
  hdrObject.steps = hdr.steps;
  hdrObject.currentStep = 1;
  hdrPhoto(hdrObject.steps);
});


/*
  Command to trigger a timelapse
*/
socket.on('timelapse', function(tl) {
  tlObject.tlDirectory = __dirname+'/timelapses/tl'+Date.now();
//create the directory for tl images
  if(!fs.existsSync(tlObject.tlDirectory)){
    fs.mkdirSync(tlObject.tlDirectory);
  }

  //TODO make sure these values are reasonable/error check
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

//runs at startup and makes sure the socket path is good. We don't really use this now
fs.stat(socketPath, function(err) {
	if (!err) fs.unlinkSync(socketPath);
	var unixServer = net.createServer(function(localSerialConnection) {
		localSerialConnection.on('data', function(data) {
			buffer = data;
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

//on startup make sure the timelapsses directory exists
if(!fs.existsSync('./timelapses')){
  fs.mkdirSync('./timelapses');
}

sysInit.sysInitSetup(Q, exec);
sysInit.getLibgphotoVersion().then(function(version){
  console.log("Got the libgphoto version!");
});

/*
The following should only run the first time
this set up the murata wifi module by moving files to the correct location
*/
if(!fs.existsSync('/swap')){
  sysInit.swapInit();
  sysInit.copyMurataFirmware();
  sysInit.copyMurataSDRAM();
}

//start up in AP mode
sysInit.startWifiAP();

var gphotoInit = function(){
  GPhoto = undefined;//clear out previous sessions
  GPhoto = new gphoto2.GPhoto2();
  //get the camera, once the promise returns then go into function
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

//set up the http express routes and hand over the various objects that http interacts with
var app = require('express')();
var routes = require('./expressRoutes');
routes.initRoutes(app, fs, spawn, returnCamera, gphotoLiveView, gphotoCapture, downloadImage, gphotoInit, downsize, compressionFactor, tlObject);

console.log("Init complete. Running...");
//currently this will only find a camera if it is present on startup
//TODO loop around and wait for camera
gphotoInit();

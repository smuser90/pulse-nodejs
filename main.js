var express = require('express');
var app = express();
var fs = require('fs');
const gphoto2 = require('gphoto2');
const GPhoto = new gphoto2.GPhoto2();
var camera;
var buffer;

var socketPath = '/run/sock1.sock';
var net = require('net');
var burst = 0;

app.get('/frame', function (req, res) {
  gphotoLiveView(res);
});

app.get('/', function(req, res){
  res.send('Its lit!');
});

app.listen(80, function () {
  console.log('Server listening on port 80!')
});

GPhoto.list(function(list){
	if(list.length === 0){
	console.log('No camera found!');
	process.exit(1);
	}
	camera = list[0];
	camera.setConfigValue('capturetarget', 1, function(er){
		console.log('Error setting capture target: '+er);
	});
});

function gphotoLiveView(response){
	//console.log(Date.now()+": Getting LV Frame");
	burst = 0;
	camera.takePicture({
		preview: true,
		socket: socketPath
		//targetPath: '/foo.XXXXXX'
	}, function(er, tmpname){
		if(er){
			console.log("Error: "+er);
			return;
		}
		//console.log(Date.now()+": Got frame - "+tmpname);
		//buffer = fs.readFileSync(tmpname);
		response.send(buffer);
	});
}

fs.stat(socketPath, function(err){
	if(!err) fs.unlinkSync(socketPath);
	var unixServer = net.createServer(function(localSerialConnection) {
        localSerialConnection.on('data', function(data) {
                //console.log(Date.now()+": Burst - "+burst);
                                                if(burst === 0){
                                                        buffer = data;
                                                }else{
                                                        buffer = Buffer.concat([buffer, data]);
                                                }
                                                burst++;

        });
        // write to socket with localSerialConnection.write()
    });

        unixServer.listen(socketPath, function(err, path){
                if(!err){
                console.log("IPC Server started!");
                }
        });
});


var Q, exec;

module.exports = {
  sysInitSetup : function(_q, _exec){
    Q = _q;
    exec = _exec;
  },

  swapInit : function(){
    var createSwap = function(){
      console.log("Creating Swap...");
      var deferred = Q.defer();
      exec("dd if=/dev/zero of=/swap bs=1M count=128", function(error, stdout, stderr){
        if(error instanceof Error){
          console.log("Error creating swap: "+error);
          deferred.reject(error);
        }else{
          console.log("Success creating swap");
          deferred.resolve(stdout);
        }
      });
      return deferred.promise;
    };

    var makeSwap = function(){
      console.log("Converting file to swap..");
      var deferred = Q.defer();
      exec("mkswap /swap", function(error, stdout, stderr){
        if(error instanceof Error){
          console.log("Error converting swap: "+error);
          deferred.reject(error);
        }else{
          console.log("Success converting swap");
          deferred.resolve(stdout);
        }
      });
      return deferred.promise;
    };

    var swapon = function(){
      console.log("Turning on swapfile...");
      var deferred = Q.defer();
      exec("swapon /swap", function(error, stdout, stderr){
        if(error instanceof Error){
          console.log("Error turning on swapfile: "+error);
          deferred.reject(error);
        }else{
          console.log("Success turning on swap");
          deferred.resolve(stdout);
        }
      });
      return deferred.promise;
    };

    var persistSwap = function(){
      console.log("Persisting swap for subsequent boots");
      var deferred = Q.defer();
      exec("echo '/swap none swap sw 0 0' >> /etc/fstab", function(error, stdout, stderr){
        if(error instanceof Error){
          deferred.reject(error);
        }else{
          deferred.resolve(stdout);
        }
      });
      return deferred.promise;
    };

    createSwap().then(
      function(){
        makeSwap().then(
          function(){
              swapon().then(
                function(){
                  persistSwap();
                }
              );
          }
        );
      }
    );
  }
};

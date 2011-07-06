Contracts for JS (more to come)

# Usage

Basic usage...API still very much in flux

    // basic module pattern
    (function() {
      // alias contract library
      var C = Contracts.C; // holds combinators
      var K = Contracts.K; // holds pre-defined contracts

      // 
      return {
        // basic first-order stuff...essentially does nothing...
        x: C.guard(K.Number, 4, "server", "client"),
        y: C.guard(K.String, "hello", "server", "client"),

        // simple function
        inc1: C.guard(
                C.fun(K.Number, K.Number), // function from numbers to numbers
                function(x) { return x++; },
                "server", 
                "client"),

        // higher order function
        sort: C.guard(
                C.fun(C.fun(K.Number, K.Bool), K.Array,   // takes two args...a function (of nums to bools) and an array
                      K.Array),                           // and returns an array
                function(cmp, l) { ... },
                "server",
                "client"),

         // dependent contract
         inc2: C.guard(
                    C.funD(K.Number, function(arg) { 
                                     return C.flat(function(result) { // gives us access to the argument in the range contract
                                            return arg < result;
                                     })}),
                    function(x) { return x + 1; },
                    "server",
                    "client"),

         // basic object
         point: C.guard(C.object({ x: K.Number, y: K.Number }),
                        {x: 0, y: 0},
                        "server",
                        "client"),
                        
         // object with method and precondition
         counter: C.guard(
                        C.object({
                                x: K.Number,
                                dec: C.fun(C.any, K.Number, {
                                    pre: function(obj) {    // in addition to checking argument this
                                         return obj.x > 0;  // precondition check will run before the function is called
                                    },
                                    post: function(obj) {
                                          // post condition logic...
                                    }
                                })
                        }),
                        { x: 0,
                          dec: function() { return this.x--; }
                        },
                        "server",
                        "client")
      };
    })();

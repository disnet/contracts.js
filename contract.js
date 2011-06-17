var C = (function() {
  function blame(toblame, k, val) {
    throw {
      name: "BlameError",
      message: "I blame: " + toblame + " for violating " + k + " with value: " + val
    };
  }

  // contract combinators
  return {
    flat: function(p, name) {
      return function(pos, neg) {
        return function(x) {
          if (p(x)) 
            return x;
          else
            blame(pos, name, x);
        };
      };
    },
    fun: function(dom, rng) {
      return function(pos, neg) {
        return function(f) {
          return function(x) {
            var domp = dom(neg, pos);
            var rngp = rng(pos, neg);
            return rngp(f(domp(x)));
          };
        };
      };
    },
    any: function(pos, neg) {
      return function(val) {
        return val;
      };
    },
    none: function(pos, neg) {
      return function(val) {
        blame(pos, "none", val);
      };
    },
    and: function(k1, k2) {
      return function(pos, neg) {
        return function(val) {
          return k2(pos, neg)(k1(pos, neg)(val));
        }
      };
    },
    guard: function(k, x, pos, neg) {
      return k(pos, neg)(x);
    }
  };
})();

var K = (function() {
  // Some basic contracts
  return {
    Number: C.flat(function(x) {
      if(typeof(x) === "number")
        return true;
      else
        return false;
    }, "Number"),
    Odd: C.flat(function(x) {
      if( (x % 2) === 1) 
        return true;
      else
        return false;
    }, "Odd"),
    Even: C.flat(function(x) {
      if( (x % 2) === 1) 
        return false;

      else
        return true;
    }, "Even"),
    Pos: C.flat(function(x) {
      return x >= 0;
    }, "Pos")
  };
})();


var M = (function () {
  // wrapping the math library in contracts
  function badAbs(x) {
    return x;
  }
  function id(x) { return x; }
  return {
    id: C.guard(C.fun(C.any, C.any), id, "server", "client"),
    idNone: C.guard(C.fun(C.none, C.none), id, "server", "client"),
    abs: C.guard(C.fun(K.Number, C.and(K.Number, K.Pos)), Math.abs, "server", "client"),
    badAbs: C.guard(C.fun(K.Number, C.and(K.Number, K.Pos)), badAbs, "server", "client") 
  }
})();




(function test() {
  var i = 0;
  var errorLog = [];
  function log(e) {
    errorLog.push(e);
  }

  var tests = [
    {f: M.id, a:[3], b: false},
    {f: M.idNone, a:[3], b: true},
    {f: M.abs, a: [4], b: false},
    {f: M.badAbs, a: [-4], b: true},
    {f: M.abs, a: ["hi"], b: true}
  ];
  for(i = 0; i < tests.length; i++) {
    var test = tests[i];

    try {
      test.f.apply(this, test.a)
      if(test.b) { log("failed to blame for " + test); }
    } catch (e) {
      log(e);
    }
  }
  return errorLog;
})();

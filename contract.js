var C = (function() {
  function blame(toblame, k, val) {
    throw {
      name: "BlameError",
      message: "I blame: " + toblame + " for violating " + k + " with value: " + val
    };
  }

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
  return {
    Number: function(x) {
      if(typeof(x) === "number")
        return true;
      else
        return false;
    },
    Odd: function(x) {
      if( (x % 2) === 1) 
        return true;
      else
        return false;
    },
    Even: function(x) {
      if( (x % 2) === 1) 
        return false;
      else
        return true;
    }
  };
})();


var T = (function () {

  function id(x) {
    return x;
  }

  function inc(x) {
    return x+1;
  }

  return {
    id: C.guard(C.fun(C.flat(K.Number, "Number"), C.flat(K.Number, "Number")), id, "server", "client"),
    inc: C.guard(C.fun(C.flat(K.Even, "Even"), C.flat(K.Odd, "Odd")), inc, "server", "client"),
  }

})();




(function test() {
  function assert(b) {
    if (!b) {
      throw {
        name: "AssertError",
        message: "Failed assert"
      }
    }
  }

  assert(T.id(4) === 4);
  assert(T.inc(4) === 5);

  assert(T.inc(5) === 6);
  return "passed all tests";
})();

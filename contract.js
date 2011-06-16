var C = (function() {
  return {
    flat: function(p) {
      return function(x) {
        if (!p(x)) {
          throw {
            name: "Failing contract: " + x,
            message: "todo..."
          }
        }
      };
    },
    fun: function(dom, rng) {
      return function(f) {
        return function(x) {
          dom(x);
          var r = f(x);
          rng(r);
          return r;
        };
      };
    },
    guard: function(k, x) {
      return k(x);
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
    id: C.guard(C.fun(C.flat(K.Number), C.flat(K.Number)), id),
    inc: C.guard(C.fun(C.flat(K.Even), C.flat(K.Odd)), inc),
  }

})();


function assert(b) {
  if (!b) {
    throw {
      name: "AssertError",
      message: "Failed assert"
    }
  }
}


(function test() {
  assert(T.id(4) === 4);
  assert(T.inc(4) === 5);

  assert(T.inc(5) === 6);
  return "passed all tests";
})();

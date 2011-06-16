var T = (function () {

  function id(x) {
    return x;
  }

  function badId(x) {
    return x+1;
  }

  return {
    id: C.wrap(id),
    badId: C.wrap(badId)
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
  assert(T.badId(4) === 4);
  return "passed all tests";
})();

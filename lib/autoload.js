// load all the contract identifiers into the global scope
function load(obj) {
  var name, root;
  root = typeof global !== "undefined" && global !== null ? global : this;
  for(name in obj) {
    if(obj.hasOwnProperty(name)) {
      root[name] = obj[name];
    }
  }
}
load(Contracts.contracts);
load(Contracts.combinators);

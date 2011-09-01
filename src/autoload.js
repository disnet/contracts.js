// load all the contract identifiers into the global scope
function load(obj) {
  var name;
  for(name in obj) {
    if(obj.hasOwnProperty(name)) {
      this[name] = obj[name];
    }
  }
}
load(Contracts.contracts);
load(Contracts.combinators);

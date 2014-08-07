import @ from "contracts.js"
var c = require('rho-contracts');

@ (Num) -> Num
function id(x) { return x; }

var rhoId = c.fun({
    x: c.number
}).returns(c.number).wrap(function(x) { return x; });

module.exports = {
    name: "CJS vs RHO - Identity function",
    tests: {
        'CJS - id(100)': function() {
            id(100);
        },
        'RHO - id(100)': function() {
            rhoId(100);
        }
    }
};

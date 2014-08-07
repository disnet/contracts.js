import @ from "contracts.js"
var c = require('rho-contracts');

function baseId(x) { return x; }

@ (Num) -> Num
function id(x) { return x; }

var rhoId = c.fun({
    x: c.number
}).returns(c.number).wrap(function(x) { return x; });

module.exports = {
    name: "contracts.js vs rho-contracts",
    tests: {
        // 'Id no contracts': function() {
        //     baseId(100);
        // },
        'Id contracts.js': function() {
            id(100);
        },
        'Id rho-contracts': function() {
            rhoId(100);
        }
    }
};

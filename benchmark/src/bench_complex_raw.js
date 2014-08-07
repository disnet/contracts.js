import @ from "contracts.js"
var c = require('rho-contracts');


var rhoMkSort = c.fun({
    x: c.number
}).returns(c.number).wrap(
function (x) {
    var arr = [];
    for (var i = 0; i < x; i++) {
        arr.push(i);
    }
    arr.sort();
    return arr[0];
}
);


@ (Num) -> Num
function mkSort(x) {
    var arr = [];
    for (var i = 0; i < x; i++) {
        arr.push(i);
    }
    arr.sort();
    return arr[0];
}

module.exports = {
    name: "CJS vs RHO - mkSort function",
    tests: {
        'RHO - mkSort(10000)': function() {
            rhoMkSort(10000);
        },
        'CJS - mkSort(10000)': function() {
            mkSort(10000);
        }
    }
};

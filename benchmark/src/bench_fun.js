import @ from "contracts.js"
var c = require('rho-contracts');


var rhoFib = c.fun({
    x: c.number
}).returns(c.number).wrap(
function (n) {
  return n < 2 ? n : rhoFib(n - 1) + rhoFib(n - 2);
}
);

@ (Num) -> Num
function fibonacci(n) {
  return n < 2 ? n : fibonacci(n - 1) + fibonacci(n - 2);
}

module.exports = {
    name: "CJS vs RHO - Fibonacci function",
    tests: {
        'RHO - fibonacci(10)': function() {
            rhoFib(10);
        },
        'CJS - fibonacci(10)': function() {
            fibonacci(10);
        }
    }
};

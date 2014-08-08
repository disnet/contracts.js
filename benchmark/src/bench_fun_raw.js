import @ from "contracts.js"


function fibonacciRaw(n) {
  return n < 2 ? n : fibonacciRaw(n - 1) + fibonacciRaw(n - 2);
}

@ (Num) -> Num
function fibonacci(n) {
  return n < 2 ? n : fibonacci(n - 1) + fibonacci(n - 2);
}

module.exports = {
    name: "CJS vs Vanilla - Fibonacci function",
    tests: {
        'Vanilla - fibonacci(10)': function() {
            fibonacciRaw(10);
        },
        'CJS - fibonacci(100)': function() {
            fibonacci(10);
        }
    }
};

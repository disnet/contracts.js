import @ from "contracts.js"

function baseId(x) { return x; }

@ (Num) -> Num
function id(x) { return x; }

module.exports = {
    name: "CJS vs Vanilla - Identity function",
    tests: {
        'Vanilla - id(100)': function() {
            baseId(100);
        },
        'CJS - id(100)': function() {
            id(100);
        }
    }
};

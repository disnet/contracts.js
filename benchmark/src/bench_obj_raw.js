import @ from "contracts.js"


@ let Obj = {
    a: Num,
    b: Str,
    c: {
        d: Num
    }
}

function baseSort(obj) {
    var arr = [];
    for (var i = 0; i < obj.a; i++) {
        arr.push(i);
    }
    arr.sort();
    return obj;
}

@ (Obj) -> Obj
function sort(obj) {
    var arr = [];
    for (var i = 0; i < obj.a; i++) {
        arr.push(i);
    }
    arr.sort();
    return obj;
}

module.exports = {
    name: "CJS vs Vanilla - object sorting function",
    tests: {
        'Vanilla - sort({ ... })': function() {
            baseSort({a: 1000, b: "hello", c: { d: 100 }});
        },
        'CJS - sort({ ... })': function() {
            sort({a: 1000, b: "hello", c: { d: 100 }});
        }
    }
};

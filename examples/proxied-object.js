import @ from "contracts.js"

// If you're running this particular example in
// Chrome you'll need to enable harmony features first
// by going to chrome://flags/#enable-javascript-harmony
// Firefox works out of the box.
@ (Str, Num) -> !{name: Str, age: Num}
function makePerson(name, age) {
    return {
        name: name,
        age: age
    };
}

var o = makePerson("Bob", 42);
o.age = "100";

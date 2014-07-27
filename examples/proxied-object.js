import @ from "contracts.js"

@ (Str, Num) -> !{name: Str, age: Num}
function makePerson(name, age) {
    return {
        name: name,
        age: age
    };
}

var o = makePerson("Bob", 42);
o.age = "100";

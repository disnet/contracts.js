import @ from "contracts.js"

@ (Str, Num) -> {name: Str, age: Num}
function makePerson(name, age) {
    return {
        name: name,
        age: age
    };
}

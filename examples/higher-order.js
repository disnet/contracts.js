import @ from "contracts.js"

@ (Num, (Num, Num) -> Num) -> Num
function callTwo(x, f) {
    return f("two", x);
}

callTwo(100, function(x, y) {
    return x + y;
});

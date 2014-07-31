import @ from "contracts.js"

@ forall a (a) -> a
function inc_if_odd(x) {
    if (x % 2 !== 0) {
        return x + 1;
    }
    return x;
}

inc_if_odd(100);

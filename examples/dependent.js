import @ from "contracts.js"

@ (x: Pos) -> res: Num | res <= x
function bad_square_root(x) {
    // oops, square *root* not square!
    return x * x;
}

bad_square_root(100);

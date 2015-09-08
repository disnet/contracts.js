import @ from "contracts.js"

@ (x: Pos) -> res:Num | x > (res * res - 0.1) &&
                        x < (res * res + 0.1)
function bad_square_root(x) {
    // oops, square *root* not square!
    return x * x;
}

bad_square_root(100);

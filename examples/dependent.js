import @ from "contracts.js"

@ (x: Pos) -> res:Num | res > (Math.sqrt(x) - 0.1) &&
                        res < (Math.sqrt(x) + 0.1)
function bad_square_root(x) {
    // oops, square *root* not square!
    return x * x;
}

bad_square_root(100);

import @ from "contracts.js"

@ forall a ([...a]) -> [...a]
function arrayId(l) {
    return l;
}
arrayId([1, 2, "three"]);

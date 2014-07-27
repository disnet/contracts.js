import @ from "contracts.js"

@ ({name: Str}, [...{loc: Num}]) -> Str
function calcAverageLoc(person, locArr) {
    var sum = locArr.reduce(function (l1, l2) {
        return l1.loc + l2.loc;
    });
    return "Average lines of code for " +
           person.name + " was " +
           sum / locArr.length;
}

var typoPerson = {nam: "Bob"};
calcAverageLoc(typoPerson, [{loc: 1000}, {loc: 789}, {loc: 9001}]);

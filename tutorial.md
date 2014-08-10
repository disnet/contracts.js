# Programmer Guard Thyself!

Bugs happen. They are one of the constants of programming along with ever-shifting requirements and hairy [yaks](http://mozillamemes.tumblr.com/post/20411658584/listen-to-the-yak) in need of shaving. 

In JavaScript tracking down the cause of a bug can be particularly frustrating. Have you ever seen this error before?

```bash
TypeError: Cannot read property 'foo' of undefined
```

While the error is descriptive enough for the proximate cause of the failure (you just tried to use an `undefined` value), it tells you very little about the ultimate cause (i.e. which piece of the code produced the `undefined` value in the first place). The actual party at fault might be in some function or file not even in the stack trace. You have to recreate the control flow in your head or jump into the debugger just to figure out who to blame. 

Wouldn't it be nice if JavaScript could stop and spit out a descriptive error message right where the bug happens?

Contracts are a way to do just that.

Contracts are a runtime invariant enforcement mechanism. They're like powerful assertions sprinkled throughout your code that stops bugs right at the source.

# Cats and Their Discontents

To understand what contracts can do for you let's start out with some cats (this is the internet after all).

```js
var spot = {
    name: "Spot",
    age: 3,
    haz: "cheezburger"
};
```

We have here a simple object that stores some basic information about our cat. While data is great and all we also need to do something with it so how about a function that checks the food habits of our friendly feline?

```js
function isVegetarian(o) {
    // apparently, only cheezburgers count as meat
    return o.haz !== "cheezburger";
}
isVegetarian(spot);  // true
```

This is great and all but what happens if we have a bad kitty?

```js
isVegetarian({
    name: "Tiger",
    age: 2
});
```

Running this will give us `true` (since `undefined !== "cheezburger"`) but that's not really right since we have no idea what Tiger haz! This is even worse than a confusing error message since we get a result that is subtly wrong.

# Enter contracts.js

Contracts allow us to fix this problem by stating and enforcing what kinds of data our functions work on. In this case the `isVegetarian` function must be called with an object with a `haz` string property and it returns a boolean. So we can apply that contract like so:

```js
@ ({haz: Str}) -> Bool
function isVegetarian(o) {
    return o.haz !== "cheezburger";
}
```

The syntax for putting a contract on a function is:

```js
@ (...) -> ...
function name(...) {
    ...
}
```

Contracts for each argument to the function go in the parentheses to the left of the `->` and the contract for the return value of the function goes on the right.

So in our `isVegetarian` example the argument contract is `{haz: Str}` (meaning an object with a `haz` string property) and the return value contract is `Bool` for boolean values. 

Note that the object contract is only checking for the `haz` property not every property that a cat object might have. We're doing a kind of "duck" contracting here (i.e. structural typing) because the `isVegetarian` function only needs the `haz` property to function properly. Other hazable objects will work too.

Now if we call `isVegetarian` with a bad argument:

```js
isVegetarian({
    name: "Tiger",
    age: 2
});
```

we get a very descriptive error message:

<pre style="color:red">
Error: isVegetarian: contract violation
expected: Str
given: undefined
in: the haz property of
    the 1st argument of
    ({haz: Str}) -> Bool
function isVegetarian guarded at line: 2
blaming: (calling context for isVegetarian)
</pre>

The contract is able to let us know exactly what it expected, what is got, and where it all went wrong. It's even blaming the correct part of the code (the caller to `isVegetarian` was at fault for supplying a bad cat object). Correct blame is actually a surprisingly deep topic that we'll return to in a bit.

# More Haz

Ok, so let's make this running example a little more interesting. At the moment our cats only have a single `haz` which is a little silly. Surely cats can `haz` a few more things?

```js
var spot = {
    name: "Spot",
    age: 3,
    haz: ["cheezburger", "dataz", "iphonez", "fwend"]
};
```

So our `haz` property is now an array of strings. The revised contract is then:

```js
@ ({haz: [...Str]}) -> Bool
function isVegetarian(o) {
    var ret = true;
    for (var i = 0; i < o.haz.length; i++) {
        if (o.haz[i] !== "cheezburger") {
            ret = false;
        }
    }
    return ret;
}
```

The contract `[...Str]` means that the value must be an array of strings. If you wanted to put a different contract for each index of the array you can do that by not using the ellipses (e.g. `[Str, Num, Bool]` is the contract for an array like `["foo", 42, true]`).

Now if we call `isVegetarian` with a bad kitty:

```js
isVegetarian({
    name: "Tiger",
    age: 2,
    haz: ["cheezburger", false]
});
```

the error message reads:

<pre style="color:red">
Error: isVegetarian: contract violation
expected: Str
given: false
in: the 1st field of
    the haz property of
    the 1st argument of
    ({haz: [....Str]}) -> Bool
function isVegetarian guarded at line: 2
blaming: (calling context for isVegetarian)
</pre>

letting us know exactly where in the array the bad field was.

# Higher-Order Cats

So obviously cat vegetarianism is a little hard to define. Is "cheezburger" really the only meat? We need to allow the caller to decide what a veggie actually is by passing in a predicate function:


```js
@ ({haz: [...Str]}, (Str) -> Bool) -> Bool
function isVegetarian(o, isVeg) {
    var ret = true;
    for (var i = 0; i < o.haz.length; i++) {
        if (!isVeg(o.haz)) { // should be o.haz[i]!
            ret = false;
        }
    }
    return ret;
}
```

Now our contract has an argument contract `(Str) -> Bool` for `isVeg`. This means that the caller to `isVegetarian` must supply a function that when called with a string will return a boolean.

But oops we goofed in the rewrite and are trying to call `isVeg` with the entire `haz` array instead the actual element. Contracts.js has our back though. When we try it out:

```js
isVegetarian({
    name: "Tiger",
    age: 2,
    haz: ["cheezburger", "dataz"]
}, function(val) {
    return val !== "cheezburger";
});
```

We get the error:

<pre style="color:red">
Error: isVegetarian: contract violation
expected: Str
given: cheezburger,dataz
in: the 1st argument of
    the 2nd argument of
    ({haz: [....Str]}, (Str) -> Bool) -> Bool
function isVegetarian guarded at line: 2
blaming: function isVegetarian
</pre>

Notice that the error blames the function `isVegetarian` instead of the caller. `isVegetarian` is the one that messed up by calling `isVeg` with the wrong thing so it is the one getting blamed.

Ok, let's fix up `isVegetarian`:

```js
@ ({haz: [...Str]}, (Str) -> Bool) -> Bool
function isVegetarian(o, isVeg) {
    var ret = true;
    for (var i = 0; i < o.haz.length; i++) {
        if (!isVeg(o.haz[i])) {
            ret = false;
        }
    }
    return ret;
}
```

But now the caller messes up:

```js
isVegetarian({
    name: "Tiger",
    age: 2,
    haz: ["cheezburger", "dataz"]
}, function(val) {
    val !== "cheezburger";
    // forgot the return keyword!
});
```

And we get a nice error message:

<pre style="color:red">
Error: isVegetarian: contract violation
expected: Bool
given: undefined
in: the return of
    the 2nd argument of
    ({haz: [....Str]}, (Str) -> Bool) -> Bool
function isVegetarian guarded at line: 2
blaming: (calling context for isVegetarian)
</pre>

Note that here blame correctly falls on the caller to `isVegetarian` for supplying a bad `isVeg` function. This may seem like a small thing but the ability to correctly ascribe blame is incredibly important as higher-order functions start to flow through your application. Without blame tracking the code at fault might not show up in either the error message or the stack trace causing you to start looking in the wrong place for the bug. With good blame tracking you always know where to look making it easier to find the bug and get back to your catnap.

# Onward

There's a lot more contracts you can apply to your cats (and other
animals). Check out the
{{#link-to 'reference'}}Reference Documentation{{/link-to}}
to see what else can be done.

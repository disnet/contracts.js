let if = macro {
    rule { $cond:expr then $then:expr else $else:expr } => {
        (function() {
            if ($cond) {
                return $then
            } else {
                return $else
            }
        }.bind(this))();
    }
    // fall through
    rule { $rest ...} => { if $rest ...}
}

export if;

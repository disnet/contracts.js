/*global module:false*/
module.exports = function(grunt) {

    var path = require("path");
    var exec = require("child_process").exec;

    // These plugins provide necessary tasks.
    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-contrib-copy');
    grunt.loadNpmTasks('grunt-contrib-watch');
    grunt.loadNpmTasks('grunt-sweet.js');
    grunt.loadNpmTasks('grunt-mocha-test');
    grunt.loadNpmTasks('grunt-template');


    // Project configuration.
    grunt.initConfig({
        // Task configuration.
        sweetjs: {
            contracts: {
                options: {
                    readableNames: true,
                    modules: ["sparkler/macros", "es6-macros", "./src/helper-macros.js"]
                },
                src: "src/contracts.js",
                dest: "build/contracts.js"
            },
            tests: {
                options: {
                    readableNames: true,
                    modules: ["./macros/index.js"]
                },
                src: "test/test_contracts.js",
                dest: "build/tests/test_contracts.js"
            }
        },
        template: {
            macros: {
                options: {
                    data: function() {
                        return {
                            lib: grunt.file.read("build/contracts.js")
                        };
                    }
                },
                src: "src/macros.js",
                dest: "build/macros/index.js"
            },
            diabledMacros: {
                options: {
                    data: function() {
                        return {
                            lib: grunt.file.read("build/contracts.js")
                        };
                    }
                },
                src: "src/macros-disabled.js",
                dest: "build/macros/disabled.js"
            }
        },
        copy: {
            macros: {
                expand: true,
                flatten: true,
                src: "build/macros/*",
                dest: "macros/"
            }
        },
        jshint: {
            options: {
                curly: true,
                eqeqeq: true,
                immed: true,
                latedef: true,
                newcap: true,
                noarg: true,
                sub: true,
                undef: true,
                unused: true,
                boss: true,
                eqnull: true,
                globals: {
                    jQuery: true
                }
            },
            gruntfile: {
                src: 'Gruntfile.js'
            },
            lib_test: {
                src: ['contracts.js', 'test/**/*.js']
            }
        },
        pandoc: {
            options: {
                pandocOptions: ["--to=html5",
                                "--standalone",
                                "--toc",
                                "--number-sections",
                                "--include-in-header=doc/main/style/main.css"]
            },
            files: {
                expand: true,
                flatten: true,
                src: "doc/main/*.md",
                dest: "doc/main/",
                ext: ".html"
            }
        },
        mochaTest: {
            contracts: {
                src: ["build/tests/*.js"]
            }
        },
        watch: {
            scripts: {
                files: ["src/*", "test/*"],
                tasks: ["sweetjs:contracts", "template", "sweetjs:tests", "mochaTest"]
            },
            docs: {
                files: ["doc/main/*"],
                tasks: ["docs"]
            }
        }
    });


    grunt.registerMultiTask("pandoc", function() {
        var cb = this.async();
        var options = this.options({});
        var pandocOpts = options.pandocOptions.join(" ");
        this.files.forEach(function(f) {

            f.src.forEach(function(file) {
                var args = ["-o " + f.dest].concat(pandocOpts.slice())
                                          .concat(file);
                exec("pandoc " + args.join(" "), cb);
            });
        });
    });

    // Default task.
    grunt.registerTask('default', ["sweetjs:contracts", "template", "copy", "sweetjs:tests", "mochaTest"]);

    grunt.registerTask("docs", ["pandoc"]);

};

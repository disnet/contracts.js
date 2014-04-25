/*global module:false*/
module.exports = function(grunt) {

  // These plugins provide necessary tasks.
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-copy');
  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-sweet.js');

  // Project configuration.
  grunt.initConfig({
    // Task configuration.
    sweetjs: {
      options: {
        readableNames: true,
        modules: ["./macros/index.js"]
      },
      tests: {
        src: "test/test_macros.js",
        dest: "build/test_macros.js"
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
    copy: {
      main: {
        expand: true,
        flatten: true,
        src: "src/contracts.js",
        dest: "./"
      }
    },
    watch: {
      scripts: {
        files: ["src/*", "test/*", "macros/*"],
        tasks: ["copy", "sweetjs"]
      }
    }
  });


  // Default task.
  grunt.registerTask('default', ['copy']);

};

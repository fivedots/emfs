// Copyright 2019 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

mergeInto(LibraryManager.library, {
  //$AsyncFSImpl__deps: ['$FS'],
  /*$NATIVEIOFS__postset: '' +
      'if (typeof io !== "undefined") {' +
      //'console.log("IO", io);' +
      '}',*/
  /*$AsyncFSImpl__postset: '' +
      'addRandomDev();',*/
  $AsyncFSImpl: {


    /* Debugging */

    debug: function(...args) {
      entries = io.listByPrefix('');
      decodedEntries = [];
      for (e of entries) { decodedEntries.push(AsyncFSImpl.decodePath(e)) }
      console.log('nativeiofs', arguments, decodedEntries);
    },

    /* Profiling */

    profileData: {},

    profileMetric: function(name, value) {
      if (name in AsyncFSImpl.profileData) {
        AsyncFSImpl.profileData[name].value += value;
        AsyncFSImpl.profileData[name].count++;
      } else {
        AsyncFSImpl.profileData[name] = {
          value: value,
          count: 1,
        }
      }
    },

    profile: function(name, wakeUp, fn) {
      var start = performance.now();
      var callback = function(ret) {
        var value = performance.now() - start;
        AsyncFSImpl.profileMetric(name, value);
        if(ret == -{{{cDefine('ENOSYS')}}}) {
          console.log('WARNING: there was a profiled call to', name,
                        'but this function is not implemented.');
        } else if(ret < 0 /*&& (ret != -44 && name != 'stat')*/) {
          console.log('WARNING: there was a profiled call to', name,
                         'that returned a negative errno: ', ret);
        }
        wakeUp(ret)
      }
      fn(callback)
    },

    /* Syscalls */

    lastFileDescriptor: 100,
    //Associates a fileDescriptor (a number) with a FileHandle. This file handle
    //is the object obtained from calling io.open and may be expanded with new
    //fields (e.g. seek_position)
    fileDescriptorToFileHandle: {},
    knownPaths: {},

    encodePath: function(path) {
      //TODO: this is a aandom hex encoding decide and document on reasonable
      //scheme
      var s = unescape(encodeURIComponent(path))
      var h = ''
      for (var i = 0; i < s.length; i++) {
          h += s.charCodeAt(i).toString(16)
      }
      return h
    },

    decodePath: function(hex) {
      var s = ''
      for (var i = 0; i < hex.length; i+=2) {
          s += String.fromCharCode(parseInt(hex.substr(i, 2), 16))
      }
      return decodeURIComponent(escape(s))
    },

    randomFH: {
      readAsync:  function(buffer, offset) {
        return new Promise(function(resolve, reject) {
          crypto.getRandomValues(buffer);
          resolve(buffer.length)
        });
      },
      read:  function(buffer, offset) {
        crypto.getRandomValues(buffer);
        return buffer.length;
      },
      closeAsync: function() {
        return Promise.resolve();
      },
      seek_position: 0
    },

    fakeCWD: '/fake_async_nativeio_dir',

    getAbsolutePath: function(pathname) {
      if(!pathname.startsWith('/')) {
        return AsyncFSImpl.fakeCWD + '/' + pathname;
      }
      return pathname;
    },

    printOpenFlag: function(flags) {
      var knownFlags = {
        'O_CREAT':{{{ cDefine('O_CREAT') }}},
        'O_EXCL':{{{ cDefine('O_EXCL') }}},
        'O_DIRECTORY':{{{ cDefine('O_DIRECTORY') }}},
        'O_TRUNC':{{{ cDefine('O_TRUNC') }}},
        'O_RDONLY':{{{ cDefine('O_RDONLY') }}},
        'O_SYNC':{{{ cDefine('O_SYNC') }}},
        'O_RDWR':{{{ cDefine('O_RDWR') }}},
        'O_WRONLY':{{{ cDefine('O_WRONLY') }}},
        'O_APPEND':{{{ cDefine('O_APPEND') }}},
        'O_NOFOLLOW':{{{ cDefine('O_NOFOLLOW') }}},
        'O_ACCMODE':{{{ cDefine('O_ACCMODE') }}}
      }
      for (kf in knownFlags) {
        if(flags & knownFlags[kf]){
          console.log('!!! open received flag', kf)
        }
      }
    },

    open: function(pathname, flags, mode, wakeUp) {
      AsyncFSImpl.debug('open', arguments);
      AsyncFSImpl.profile('open', wakeUp, function(callback) {
        //TODO: consider handling opens for directories
        //TODO: consifer handling flags
        //var create = flags & {{{ cDefine('O_CREAT') }}};
        AsyncFSImpl.printOpenFlag(flags);
        if(flags & {{{ cDefine('O_APPEND') }}}) {
          console.log('WARNING open called with unsupported append flag');
        }

        if(flags & {{{ cDefine('O_TRUNC') }}}) {
          console.log('WARNING open called with unsupported O_TRUNC flag');
        }

        var absolutePath = AsyncFSImpl.getAbsolutePath(pathname);

        getFD = (fh) => {
          fh.seek_position = 0;
          var fd = AsyncFSImpl.lastFileDescriptor++;
          AsyncFSImpl.fileDescriptorToFileHandle[fd] = fh;
          AsyncFSImpl.knownPaths[absolutePath] = true;
          console.log('open path', absolutePath, 'fd', fd);
          callback(fd);
        }

        if(absolutePath == '/dev/urandom') {
          getFD(AsyncFSImpl.randomFH);
          return;
        }
        var encodedPath = AsyncFSImpl.encodePath(absolutePath);
        if(AsyncFSImpl.knownPaths[encodedPath]) {
          console.log('open known file', absolutePath, 'listByPrefix' ,io.listByPrefix(encodedPath))
        } else {
          console.log('open UNknown file', absolutePath, 'listByPrefix' ,io.listByPrefix(encodedPath))
        }

        //io.openFileAsync(encodedPath).then(getFD);
        console.log('sync open')
        var fd = io.openFile(encodedPath);
        getFD(fd);
      });
    },

    ioctl: function(fd, op, wakeUp) {
      AsyncFSImpl.debug('ioctl', arguments);
      AsyncFSImpl.profile('ioctl', wakeUp, function(callback) {
        callback(-{{{cDefine('ENOSYS')}}});
      })
    },

    populateStatBuffer: function(stat, buf) {
      {{{ makeSetValue('buf', C_STRUCTS.stat.st_dev, 'stat.dev', 'i32') }}};
      {{{ makeSetValue('buf', C_STRUCTS.stat.__st_dev_padding, '0', 'i32') }}};
      {{{ makeSetValue('buf', C_STRUCTS.stat.__st_ino_truncated, 'stat.ino', 'i32') }}};
      {{{ makeSetValue('buf', C_STRUCTS.stat.st_mode, 'stat.mode', 'i32') }}};
      {{{ makeSetValue('buf', C_STRUCTS.stat.st_nlink, 'stat.nlink', 'i32') }}};
      {{{ makeSetValue('buf', C_STRUCTS.stat.st_uid, 'stat.uid', 'i32') }}};
      {{{ makeSetValue('buf', C_STRUCTS.stat.st_gid, 'stat.gid', 'i32') }}};
      {{{ makeSetValue('buf', C_STRUCTS.stat.st_rdev, 'stat.rdev', 'i32') }}};
      {{{ makeSetValue('buf', C_STRUCTS.stat.__st_rdev_padding, '0', 'i32') }}};
      {{{ makeSetValue('buf', C_STRUCTS.stat.st_size, 'stat.size', 'i64') }}};
      {{{ makeSetValue('buf', C_STRUCTS.stat.st_blksize, '4096', 'i32') }}};
      {{{ makeSetValue('buf', C_STRUCTS.stat.st_blocks, 'stat.blocks', 'i32') }}};
      {{{ makeSetValue('buf', C_STRUCTS.stat.st_atim.tv_sec, '(stat.atime.getTime() / 1000)|0', 'i32') }}};
      {{{ makeSetValue('buf', C_STRUCTS.stat.st_atim.tv_nsec, '0', 'i32') }}};
      {{{ makeSetValue('buf', C_STRUCTS.stat.st_mtim.tv_sec, '(stat.mtime.getTime() / 1000)|0', 'i32') }}};
      {{{ makeSetValue('buf', C_STRUCTS.stat.st_mtim.tv_nsec, '0', 'i32') }}};
      {{{ makeSetValue('buf', C_STRUCTS.stat.st_ctim.tv_sec, '(stat.ctime.getTime() / 1000)|0', 'i32') }}};
      {{{ makeSetValue('buf', C_STRUCTS.stat.st_ctim.tv_nsec, '0', 'i32') }}};
      {{{ makeSetValue('buf', C_STRUCTS.stat.st_ino, 'stat.ino', 'i64') }}};
    },

    doStat: function(fh, buf) {
     // return fh.getAttributesAsync().then((attr) => {
     //   console.log('doStat fh', fh, 'size', attr.size)
     //   var stat = {};
     //   //TODO: handle directories and unfake all attrs except size
     //   stat.dev = 1;
     //   stat.ino = 1;
     //   stat.mode = 1;
     //   stat.nlink = 1;
     //   stat.uid = 0;
     //   stat.gid = 0;
     //   stat.rdev = 1;
     //   stat.size = attr.size;
     //   stat.atime = new Date();
     //   stat.mtime = new Date();
     //   stat.ctime = new Date();
     //   stat.blksize = 4096;
     //   stat.blocks = Math.ceil(attr.size / stat.blksize);
     //   AsyncFSImpl.populateStatBuffer(stat, buf);
     // })

      var attr = fh.getAttributes()
      console.log('doStat fh', fh, 'size', attr.size)
      var stat = {};
      //TODO: handle directories and unfake all attrs except size
      stat.dev = 1;
      stat.ino = 1;
      stat.mode = 1;
      stat.nlink = 1;
      stat.uid = 0;
      stat.gid = 0;
      stat.rdev = 1;
      stat.size = attr.size;
      stat.atime = new Date();
      stat.mtime = new Date();
      stat.ctime = new Date();
      stat.blksize = 4096;
      stat.blocks = Math.ceil(attr.size / stat.blksize);
      AsyncFSImpl.populateStatBuffer(stat, buf);
    },

    stat: function(path, buf, wakeUp) {
      AsyncFSImpl.debug('stat', arguments);
      AsyncFSImpl.profile('stat', wakeUp, function(callback) {
        if (!(path in AsyncFSImpl.knownPaths)) {
          callback(-{{{ cDefine('ENOENT') }}});
          return
        }
        var openFH;
        encodedPath = AsyncFSImpl.encodePath(path)
        //io.openFileAsync(encodedPath)
        //    .then((fh) => {
        //      openFH = fh;
        //      return AsyncFSImpl.doStat(fh, buf);
        //    }).then(() => {
        //      return openFH.closeAsync();
        //    }).then(() => {
        //      callback(0);
        //    });

        console.log('sync stat');
        var openFH = io.openFile(encodedPath)
        AsyncFSImpl.doStat(openFH, buf);
        openFH.close();
        callback(0);
      })
    },

    fstat: function(fd, buf, wakeUp) {
      AsyncFSImpl.debug('fstat', arguments);
      AsyncFSImpl.profile('fstat', wakeUp, function(callback) {
        var fh = AsyncFSImpl.fileDescriptorToFileHandle[fd];
        //AsyncFSImpl.doStat(fh, buf).then(() => {
        //  callback(0);
        //})

        console.log('sync fstat')
        AsyncFSImpl.doStat(fh, buf)
        callback(0);
      })
    },

    chmod: function(path, mode, wakeUp) {
      AsyncFSImpl.debug('lstat', arguments);
      AsyncFSImpl.profile('lstat', wakeUp, function(callback) {
        callback(-{{{cDefine('ENOSYS')}}});
      })
    },

    access: function(path, amode, wakeUp) {
      AsyncFSImpl.debug('access', arguments);
      AsyncFSImpl.profile('access', wakeUp, function(callback) {
        callback(-{{{cDefine('ENOSYS')}}});
      })
    },

    mkdir: function(path, mode, wakeUp) {
      AsyncFSImpl.debug('mkdir', arguments);
      AsyncFSImpl.profile('mkdir', wakeUp, function(callback) {
        callback(-{{{cDefine('ENOSYS')}}});
      })
    },

    rmdir: function(path, wakeUp) {
      AsyncFSImpl.debug('rmdir', arguments);
      AsyncFSImpl.profile('rmdir', wakeUp, function(callback) {
        callback(-{{{cDefine('ENOSYS')}}});
      })
    },

    fchown: function(fd, owner, group, wakeUp) {
      AsyncFSImpl.debug('fchown', arguments);
      AsyncFSImpl.profile('fchown', wakeUp, function(callback) {
        //We ignore permisions for now. If we started supporting an mtime, it
        //would have to be updated
        callback(0);
      })
    },

    chown: function(path, owner, group, wakeUp) {
      AsyncFSImpl.debug('chown', arguments);
      AsyncFSImpl.profile('chown', wakeUp, function(callback) {
        callback(-{{{cDefine('ENOSYS')}}});
      })
    },

    fcntl: function(fd, cmd, wakeUp) {
      AsyncFSImpl.debug('fcntl', arguments);
      debugger;
      AsyncFSImpl.profile('fcntl', wakeUp, function(callback) {
        if( cmd != {{{ cDefine('F_SETLK') }}} ) {
          callback(-{{{cDefine('ENOSYS')}}});
          return
        }
        callback(0); // Pretend that the locking was successful.
      })
    },

    //TODO: this signature comes from library_syscall_async.js but look very
    //different from the one in library_fs.js. Confirm why this is.
    read: function(fd, buffer, offset, count, wakeUp) {
      AsyncFSImpl.debug('read', arguments);
      AsyncFSImpl.profile('read', wakeUp, function(callback) {
        console.log('read sync')
        var fh = AsyncFSImpl.fileDescriptorToFileHandle[fd];
        var receiver = buffer.subarray(offset, offset + count);
        //fh.readAsync(receiver, fh.seek_position).then((bytes_read) => {
        //  if(count!=bytes_read) {
        //    console.log('WARNING read returned less than the expected bytes (got', bytes_read, 'want', count, ')')
        //  }
        //  fh.seek_position += bytes_read;
        //  callback(bytes_read);
        //})

        var bytes_read = fh.read(receiver, fh.seek_position);
        if(count!=bytes_read) {
          console.log('WARNING read returned less than the expected bytes (got', bytes_read, 'want', count, ')')
        }
        fh.seek_position += bytes_read;
        callback(bytes_read);
      })
    },

    //TODO: consider extracting common functionailty with writev
    write: function(fd, buffer, offset, count, wakeUp) {
      AsyncFSImpl.debug('write', arguments);
      AsyncFSImpl.profile('write', wakeUp, function(callback) {
        var fh = AsyncFSImpl.fileDescriptorToFileHandle[fd];
        var provider = buffer.subarray(offset, offset + count);
        //fh.writeAsync(provider, fh.seek_position).then((bytes_written) => {
        //  if(count!=bytes_written) {
        //    console.log('WARNING write returned less than the expected bytes (got', bytes_written, 'want', count, ')');
        //  }
        //  fh.seek_position += bytes_written;
        //  return bytes_written;
        //}).then((bytes_written) => {
        //  var rb = new Int8Array(count);
        //  fh.read(rb, fh.seek_position - bytes_written);
        //  for(var i = 0; i < count; i++) {
        //    if(rb[i] != provider[i]) {
        //      console.log('FATAL confirmation read does not match write buffer. rb',rb, 'wb', provider)
        //    }
        //  }
        //  callback(bytes_written);
        //})

        console.log('sync write')
        var bytes_written = fh.write(provider, fh.seek_position);
        if(count!=bytes_written) {
          console.log('WARNING write returned less than the expected bytes (got', bytes_written, 'want', count, ')');
        }
        fh.seek_position += bytes_written;
        var rb = new Int8Array(count);
        fh.read(rb, fh.seek_position - bytes_written);
        for(var i = 0; i < count; i++) {
          if(rb[i] != provider[i]) {
            console.log('FATAL confirmation read does not match write buffer. rb',rb, 'wb', provider)
          }
        }
        callback(bytes_written);
      });
    },

    readlink: function(path, buf, bufsize, wakeUp) {
      AsyncFSImpl.debug('readlink', arguments);
      AsyncFSImpl.profile('readlink', wakeUp, function(callback) {
        callback(-{{{cDefine('ENOSYS')}}});
      })
    },

    munmap: function(addr, len, wakeUp) {
      AsyncFSImpl.debug('munmap', arguments);
      AsyncFSImpl.profile('munmap', wakeUp, function(callback) {
        callback(-{{{cDefine('ENOSYS')}}});
      })
    },

    fchmod: function(fd, mode, wakeUp) {
      AsyncFSImpl.debug('fchmod', arguments);
      AsyncFSImpl.profile('fchmod', wakeUp, function(callback) {
        callback(-{{{cDefine('ENOSYS')}}});
      })
    },

    fsync: function(fd, wakeUp) {
      AsyncFSImpl.debug('fsync', arguments);
      AsyncFSImpl.profile('fsync', wakeUp, function(callback) {
        AsyncFSImpl.fileDescriptorToFileHandle[fd].syncAsync().then(() => {
          callback(0);
        })
      })
    },

    mmap2: function(addr, len, prot, flags, fd, off, wakeUp) {
      AsyncFSImpl.debug('mmap2', arguments);
      AsyncFSImpl.profile('mmap2', wakeUp, function(callback) {
        callback(-{{{cDefine('ENOSYS')}}});
      })
    },

    readv: function(fd, iovs, wakeUp) {
      AsyncFSImpl.debug('readv', arguments);
      AsyncFSImpl.profile('readv', wakeUp, function(callback) {
        console.log('!!!! readv')
        callback(-{{{cDefine('ENOSYS')}}});
      })
    },

    writev: function(fd, iovs, wakeUp) {
      //console.log('!!! writev', arguments);
      AsyncFSImpl.debug('writev', arguments);
      AsyncFSImpl.profile('writev', wakeUp, function(callback) {
        var res = 0;
        var iovSum = 0;
        var fh = AsyncFSImpl.fileDescriptorToFileHandle[fd];
        var chain = Promise.resolve();

        for(iov of iovs) {
          chain = chain.then(() => {
            iovSum += iov.len;
            var provider = HEAPU8.subarray(iov.ptr, iov.ptr + iov.len);
            return fh.writeAsync(provider, fh.seek_position)
          }).then((bytes_written) => {
              res += (bytes_written);
          })
        }

        chain.then((bytes_written) => {
          res += n;
        }).catch((err) => {
          console.log('WARNING writev returned an err:', err, 'after writing', res, 'bytes');
        }).finally(() => {
          //console.log('!!! writev wrote', bytes_written, 'of', iovSum)
          callback(res)
        })
      })
    },

    unlink: function(pathname, wakeUp) {
      AsyncFSImpl.debug('unlink', arguments);
      AsyncFSImpl.profile('unlink', wakeUp, function(callback) {
        var absolutePath = AsyncFSImpl.getAbsolutePath(pathname);
        if(!AsyncFSImpl.knownPaths[absolutePath]) {
          callback( -{{{ cDefine('ENOENT') }}} );
          return;
        }

        encodedPath = AsyncFSImpl.encodePath(absolutePath);
        //io.unlinkAsync(encodedPath).then(() => {
        //     delete AsyncFSImpl.knownPaths[absolutePath];
        //   callback(0);
        // }).catch((ret) => {
        //   //TODO: handle different error codes
        //   console.log('!!! Error unlinking', absolutePath, 'ret:', ret);
        //   delete AsyncFSImpl.knownPaths[absolutePath];
        //   callback(ret)
        // });

        try {
          console.log('unlink sync')
          io.unlink(encodedPath);
        } catch(err) {
          console.log(err);
        } finally {
          delete AsyncFSImpl.knownPaths[absolutePath];
          callback(0);
        }
      })
    },

    truncate: function(fd, length, wakeUp) {
      AsyncFSImpl.debug('truncate', arguments);
      AsyncFSImpl.profile('truncate', wakeUp, function(callback) {
        var fh = AsyncFSImpl.fileDescriptorToFileHandle[fd]
        fh.setAttributesAsync({size: length}).then(() => {
          callback(0);
        })
      })
    },

    //This function does not conform to the common linux llseek, rather it is
    //used for wasi so it's expected to return the new offset relative to the
    //start of a file via wakeUp
    llseek: function(fd, offset_high, offset_low, whence, wakeUp) {
      AsyncFSImpl.debug('llseek', arguments);
      AsyncFSImpl.profile('llseek', wakeUp, function(callback) {
        var HIGH_OFFSET = 0x100000000; // 2^32
        // use an unsigned operator on low and shift high by 32-bits
        var offset = offset_high * HIGH_OFFSET + (offset_low >>> 0);
        var position = offset;
        if (whence === {{{ cDefine('SEEK_CUR') }}}) {
          console.log('llseek SEEK_CUR')
          position += AsyncFSImpl.fileDescriptorToFileHandle[fd].seek_position
        } else if (whence === {{{ cDefine('SEEK_END') }}}) {
          //TODO: implement if we are unlucky and the benchmark requires this
          //branch
          callback(-{{{cDefine('ENOSYS')}}});
          return
        }
        AsyncFSImpl.fileDescriptorToFileHandle[fd].seek_position = position;
        callback(position)
      })
    },

    close: function(fd, wakeUp) {
      AsyncFSImpl.debug('close', arguments);
      AsyncFSImpl.profile('close', wakeUp, function(callback) {
        //TODO generally add handling of std streams
        if(fd < 2) {
          callback(0)
          return;
        }
        AsyncFSImpl.fileDescriptorToFileHandle[fd].closeAsync().then(() => {
          //if(!(fd in AsyncFSImpl.fileDescriptorToFileHandle)) {
          //  wakeUp(-{{{cDefine('EBADF')}}})
          //}
          delete AsyncFSImpl.fileDescriptorToFileHandle[fd];
          callback(0)
        })
      })
    },

}
});

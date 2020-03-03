// Copyright 2019 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/stat.h>
#include <time.h>
#include <string.h>

#include <emscripten.h>

void log(const char* str) {
  EM_ASM({ console.log("log:", UTF8ToString($0)) }, str);
}

void error(const char* str) {
  log(str);
  exit(1);
}

int main() {

  log("opening");
  FILE* f = fopen("test_file", "r");
  if (!f) error("open error");
  int fd = fileno(f);
  EM_ASM({ console.log("log:", $0) }, fd);

  log("stating");
  struct stat buf;
  char * p1 = ctime(&buf.st_mtim.tv_sec);
  p1[strcspn(p1, "\r\n")] = 0;
  log(p1);
  if (stat("test_file", &buf) != 0) error("stat error");
  char * p2 = ctime(&buf.st_mtim.tv_sec);
  p2[strcspn(p2, "\r\n")] = 0;
  log(p2);

  log("reading");
  const int N = 5;
  char buffer[N];
  int rv = fread(buffer, 1, N, f);
  if (rv != N) error("read error");

  log("checking");
  for (int i = 0; i < N; i++) {
    EM_ASM({ console.log("read:", $0, $1) }, i, buffer[i]);
    if (buffer[i] != i * i) error("data error");
  }

  log("closing");
  rv = fclose(f);
  if (rv) error("close error");

  log("ok.");
  return 0;
}


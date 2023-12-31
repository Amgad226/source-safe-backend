import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginatorEntity } from 'src/base-module/pagination/paginator.entity';
import { PaginatorHelper } from 'src/base-module/pagination/paginator.helper';
import { QueryParamsInterface } from 'src/base-module/pagination/paginator.interfaces';
import {
  TokenPayloadType,
  UserTokenPayloadType,
} from 'src/base-module/token-payload-interface';
import { PrismaService } from 'src/prisma/prisma.service';
import { AddUsersDto } from './dto/add-users.dto';
import { BaseFolderEntity } from './entities/base-folder.entity';
import { FolderWithFilesEntity } from './entities/folder.entity';
import { FolderIndexEntity } from './entities/folder-index.entity';
import { RemoveUserDto } from './dto/remove-user.dto';
import { FileEntity } from 'src/file/entities/file.entity';
import { FilterParams } from 'src/base-module/filter.interface';
import { Sql } from '@prisma/client/runtime/library';
import { isNumber } from 'class-validator';
import { log } from 'console';
import { collectDataBy } from 'src/base-module/base-entity';
import { BaseFileEntity } from 'src/file/entities/base-file.entity';
import { folderRequestsFileEntity } from 'src/file/entities/folderRequestsFileEntity';

@Injectable()
export class FolderService {
  constructor(private prisma: PrismaService) {}

  async fileRequests(id: number) {
    const files = await this.prisma.file.findMany({
      where: {
        folder_id: id,
        hide: true,
      },
      include: {
        FileVersion: true,
      },
    });
    return collectDataBy(folderRequestsFileEntity, files);
  }
  async create(
    { name, parentFolderIdDb },
    logoLocalPath: string,
    tokenPayload: TokenPayloadType,
  ) {
    const admin_folder_role = await this.prisma.folderRole.findFirst({
      where: {
        name: 'admin',
      },
      select: {
        id: true,
      },
    });
    const folder = await this.prisma.folder.create({
      data: {
        logo: logoLocalPath,
        name,
        parentFolder: {
          connect: { id: parentFolderIdDb },
        },
      },
    });
    await this.prisma.userFolder.create({
      data: {
        folder_id: folder.id,
        folder_role_id: admin_folder_role.id,
        user_id: tokenPayload.user.id,
      },
    });
    return folder;
  }
  async findAll(
    { user }: TokenPayloadType,
    params: QueryParamsInterface,
    filters: FilterParams,
  ) {
    //TODO must improve this and do it with general way
    let scopes = {};

    if (filters?.myFolders == true) {
      const adminRole = await this.prisma.folderRole.findFirst({
        where: {
          name: 'admin',
        },
      });
      scopes = {
        folder_role_id: adminRole.id,
      };
    } else if (filters?.myFolders == false) {
      const userRole = await this.prisma.folderRole.findFirst({
        where: {
          name: 'user',
        },
      });
      scopes = {
        folder_role_id: userRole.id,
      };
    }
    const folders = await PaginatorHelper<Prisma.FolderFindManyArgs>({
      model: this.prisma.folder,
      ...params,
      relations: {
        include: {
          UserFolder: { include: { user: true, folder_role: true } },

          files: {
            include: {
              FileVersion: true,
            },
          },
        },
        where: {
          UserFolder: {
            some: {
              ...scopes,

              user_id: {
                equals: user.id,
              },
            },
          },
        },
      },
    });
    folders.data.map((folder) => {
      folder['folder_size'] = folder.files.reduce((accumulator, file) => {
        const fileVersionSizes = file.FileVersion.map(
          (version) => version.size,
        );
        const totalSizeForFile = fileVersionSizes.reduce(
          (sum, size) => sum + size,
          0,
        );
        return accumulator + totalSizeForFile;
      }, 0);
      folder['files_count'] = folder.files.length;
      return folder;
    });
    return new PaginatorEntity(FolderIndexEntity, folders);
  }

  async findOne(id: number) {
    const folder = await this.prisma.folder.findUnique({
      where: { id },
      include: {
        files: { include: { FileVersion: true } },
        UserFolder: { include: { user: true, folder_role: true } },
      },
    });
    // SELECT
    // folders.*,
    // COALESCE(subquery.total_size, 0) AS total_size
    // FROM folders
    // LEFT JOIN
    //          (
    //            SELECT folder_id, SUM(file_versions.size) AS total_size
    //            FROM files
    //            JOIN file_versions ON file_versions.file_id = files.id
    //            GROUP BY folder_id
    //            ) AS subquery ON folders.id = subquery.folder_id;

    const totalSize = folder.files.reduce((accumulator, file) => {
      const fileVersionSizes = file.FileVersion.map((version) => version.size);
      const totalSizeForFile = fileVersionSizes.reduce(
        (sum, size) => sum + size,
        0,
      );
      return accumulator + totalSizeForFile;
    }, 0);
    folder['folder_size'] = totalSize;
    if (!folder) {
      throw new NotFoundException(`Folder with ID ${id} not found`);
    }
    return new FolderWithFilesEntity(folder);
  }

  async showStatisticIncludeVersions(id: number, user_id: number) {
    const stringQuery = `
    SELECT
      COUNT(file_versions.id) AS count,
      SUM(file_versions.size) AS total_size,
      CASE
        WHEN POSITION('/' IN file_versions.extension) > 0 THEN
            SUBSTRING(file_versions.extension FROM 1 FOR POSITION('/' IN file_versions.extension) - 1)
        ELSE file_versions.extension
      END AS extension_group
    FROM
      file_versions
      JOIN files ON file_versions.file_id = files.id
      join folders  on files.folder_id=  folders.id 
      join users_folders on users_folders.folder_id=folders.id
      join folder_roles on folder_roles.id = users_folders.folder_role_id 
      where files.deleted_at is null 
      and folder_roles.name= 'admin'
      and users_folders.user_id =  ${user_id} 
  `;
    let dynamicStringQuery = stringQuery;

    if (id != null && !isNaN(id)) {
      console.log(id);
      if (!isNumber(id)) {
        throw new BadRequestException(
          'This situation will not happen but I will make sure to avoid SQL INJECTION',
        );
      }
      dynamicStringQuery += `
   AND  folders.id = ${id}
  `;
    }

    dynamicStringQuery += `
  GROUP BY extension_group
`;
    const queryAsArrayString = [dynamicStringQuery];
    let query = Prisma.sql(queryAsArrayString);
    const result = await this.prisma.$queryRaw(query);

    if (Array.isArray(result)) {
      result.map((row) => {
        for (const key in row) {
          if (typeof row[key] === 'bigint') {
            row[key] = row[key].toString();
          }
        }
        return row;
      });
    }

    return result;
  }

  async showStatistic(id: number, user_id: number) {
    const stringQuery = `
    SELECT
    COUNT( files.id) AS count,
    sum(last_size) as total_size,
    CASE
        WHEN POSITION('/' IN files.extension) > 0 THEN
            SUBSTRING(files.extension FROM 1 FOR POSITION('/' IN files.extension) - 1)
        ELSE files.extension
    END AS extension_group
    FROM files
    LEFT JOIN (
    SELECT
        file_id,
        fv.size AS last_size
    FROM
        file_versions fv
    WHERE
        (fv.file_id, fv.created_at) IN (
            SELECT
                file_id,
                MAX(created_at) AS max_created_at
            FROM
                file_versions
            GROUP BY
                file_id
        )
    ) AS file_versions_last_size ON files.id = file_versions_last_size.file_id
    join folders  on files.folder_id=  folders.id 
    join users_folders on users_folders.folder_id=folders.id
    join folder_roles on folder_roles.id = users_folders.folder_role_id 
    where deleted_at is null and
    folder_roles.name= 'admin' and
    users_folders.user_id =  ${user_id} 

    `;
    let dynamicStringQuery = stringQuery;

    if (id != null && !isNaN(id)) {
      console.log(id);
      if (!isNumber(id)) {
        throw new BadRequestException(
          'This situation will not happen but I will make sure to avoid SQL INJECTION',
        );
      }
      dynamicStringQuery += `
      and folders.id= ${id} 
  `;
    }

    dynamicStringQuery += `
    GROUP BY extension_group
  `;
    const queryAsArrayString = [dynamicStringQuery];
    let query = Prisma.sql(queryAsArrayString);
    const result = await this.prisma.$queryRaw(query);

    if (Array.isArray(result)) {
      result.map((row) => {
        for (const key in row) {
          if (typeof row[key] === 'bigint') {
            row[key] = row[key].toString();
          }
        }
        return row;
      });
    }

    return result;
  }

  async addUsers(id: number, { users_ids }: AddUsersDto) {
    const folder_user_role = await this.prisma.folderRole.findFirst({
      where: {
        name: 'user',
      },
      select: {
        id: true,
      },
    });

    if (!folder_user_role) {
      throw new NotFoundException('Folder role "user" not found');
    }

    // Create userFolder entries for the specified users_ids
    const userFolderData = await Promise.all(
      users_ids.map(async (user_id) => {
        const userFolderExist = await this.prisma.userFolder.findFirst({
          where: {
            folder_id: id,
            user_id,
          },
          select: {
            id: true,
          },
        });
        if (userFolderExist) {
          return null;
        }

        const userFolderRequestExist =
          await this.prisma.userFolderRequest.findFirst({
            where: {
              folder_id: id,
              user_id,
            },
            select: {
              id: true,
            },
          });

        if (userFolderRequestExist) {
          return null;
        }
        return {
          folder_id: id,
          user_id,
        };
      }),
    );

    // Filter out null values
    const filteredUserFolderData = userFolderData.filter(Boolean);

    // Now, filteredUserFolderData contains the desired result

    return (
      await this.prisma.userFolderRequest.createMany({
        data: filteredUserFolderData,
      })
    ).count;
  }

  async deleteUser(id: number, { user_id }: RemoveUserDto) {
    const userFolderExist = await this.prisma.userFolder.findFirst({
      where: {
        folder_id: id,
        user_id,
      },
      select: {
        id: true,
      },
    });
    if (userFolderExist == null) {
      throw new NotFoundException('user not in this group');
    } else {
      const haveCheckInFiles = await this.prisma.checkIn.findFirst({
        where: {
          user_id: user_id,
          File: {
            folder_id: id,
          },
        },
      });
      if (haveCheckInFiles != null) {
        throw new BadRequestException(
          'you cant remove user form user because he has check in files',
        );
      }

      await this.prisma.userFolder.delete({
        where: {
          id: userFolderExist.id,
        },
      });
    }
  }
}
